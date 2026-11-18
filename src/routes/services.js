/**
 * Service routes.
 * - Only APPROVED vendors can create/manage services.
 * - Vendors can only modify their OWN services.
 * - Admins can delete any service and review services.
 * - Public list only shows available services from approved vendors.
 */

const express = require("express");

const { getDB } = require("../config/db");
const {
  requireVendor,
  authenticateUser,
  requireAdmin,
} = require("../middleware/auth");

const {
  toId,
  isNonEmptyString,
  isNonNegativeNumber,
} = require("../utils/helpers");

const router = express.Router();

const MAX_IMAGES = 6;

/**
 * Validate service request body.
 * partial=true is used for PATCH requests.
 */
const validateServiceBody = (body, { partial = false } = {}) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Invalid request body.";
  }

  if (!partial || body.name !== undefined) {
    if (
      !isNonEmptyString(body.name) ||
      body.name.trim().length < 3 ||
      body.name.trim().length > 100
    ) {
      return "Service name must be between 3 and 100 characters.";
    }
  }

  if (!partial || body.category !== undefined) {
    if (!isNonEmptyString(body.category)) {
      return "A valid service category is required.";
    }
  }

  if (!partial || body.price !== undefined) {
    if (body.price === "" || !isNonNegativeNumber(Number(body.price))) {
      return "A valid non-negative service price is required.";
    }
  }

  if (body.description !== undefined) {
    if (typeof body.description !== "string") {
      return "Description must be a string.";
    }

    if (body.description.length > 2000) {
      return "Description cannot exceed 2000 characters.";
    }
  }

  if (body.location !== undefined) {
    if (typeof body.location !== "string") {
      return "Location must be a string.";
    }

    if (body.location.length > 200) {
      return "Location cannot exceed 200 characters.";
    }
  }

  if (body.images !== undefined) {
    if (
      !Array.isArray(body.images) ||
      body.images.length > MAX_IMAGES ||
      !body.images.every(
        (image) => typeof image === "string" && image.trim().length > 0,
      )
    ) {
      return "Images must be an array containing up to 6 valid image URLs.";
    }
  }

  if (body.image !== undefined && typeof body.image !== "string") {
    return "Image must be a valid URL string.";
  }

  return null;
};

/**
 * Prepare safe service data.
 * The vendor ID always comes from the authenticated session.
 */
const buildServiceData = (body, vendorId) => {
  const images = Array.isArray(body.images)
    ? body.images.map((image) => image.trim())
    : body.image && body.image.trim()
      ? [body.image.trim()]
      : [];

  return {
    vendorId,
    name: body.name.trim(),
    category: body.category.trim(),
    price: Number(body.price),
    description: body.description ? body.description.trim() : "",
    location: body.location ? body.location.trim() : "",
    image: images[0] || "",
    images,
    availability: true,
    status: "pending",
  };
};

/**
 * POST /api/v1/services
 * Approved vendor creates a new service.
 */
router.post("/", requireVendor, async (req, res, next) => {
  try {
    const error = validateServiceBody(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: error,
      });
    }

    const db = getDB();
    const now = new Date();

    const serviceData = {
      ...buildServiceData(req.body, req.user.id),
      createdAt: now,
      updatedAt: now,
    };

    const result = await db.collection("services").insertOne(serviceData);

    const service = await db
      .collection("services")
      .findOne({ _id: result.insertedId });

    return res.status(201).json({
      success: true,
      message: "Service submitted for admin review.",
      service,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/services
 * Public list of approved and available services.
 */
router.get("/", async (req, res, next) => {
  try {
    const db = getDB();

    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 20, 1),
      100,
    );

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

    const approvedVendors = await db
      .collection("user")
      .find({
        role: "vendor",
        vendorApproved: true,
      })
      .project({ _id: 1 })
      .toArray();

    const query = {
      availability: true,
      $or: [
        { status: "approved" },
        // Backward compatibility for older services.
        { status: { $exists: false } },
      ],
      vendorId: {
        $in: approvedVendors.map((vendor) => vendor._id.toHexString()),
      },
    };

    if (req.query.category) {
      query.category = String(req.query.category).trim();
    }

    const total = await db.collection("services").countDocuments(query);

    const services = await db
      .collection("services")
      .find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray();

    return res.status(200).json({
      success: true,
      total,
      page,
      limit,
      services,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/services/mine
 * Vendor's own services, including pending and unavailable services.
 */
router.get("/mine", requireVendor, async (req, res, next) => {
  try {
    const db = getDB();

    const services = await db
      .collection("services")
      .find({ vendorId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json({
      success: true,
      total: services.length,
      services,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Load a service and verify ownership.
 * Admins are allowed to access any service.
 */
const loadOwnService = async (req, res) => {
  const db = getDB();

  const service = await db
    .collection("services")
    .findOne({ _id: toId(req.params.id) });

  if (!service) {
    res.status(404).json({
      success: false,
      message: "Service not found.",
    });

    return null;
  }

  const isAdmin = req.user.role === "admin";

  if (!isAdmin && service.vendorId !== req.user.id) {
    res.status(403).json({
      success: false,
      message: "Access denied. You can only manage your own services.",
    });

    return null;
  }

  return service;
};

/**
 * PATCH /api/v1/services/:id
 * Vendor updates their own service.
 */
router.patch("/:id", requireVendor, async (req, res, next) => {
  try {
    const service = await loadOwnService(req, res);

    if (!service) return;

    const error = validateServiceBody(req.body, {
      partial: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error,
      });
    }

    // Only explicitly allowed fields are updated.
    const updates = {};

    if (req.body.name !== undefined) {
      updates.name = req.body.name.trim();
    }

    if (req.body.category !== undefined) {
      updates.category = req.body.category.trim();
    }

    if (req.body.price !== undefined) {
      updates.price = Number(req.body.price);
    }

    if (req.body.description !== undefined) {
      updates.description = req.body.description.trim();
    }

    if (req.body.location !== undefined) {
      updates.location = req.body.location.trim();
    }

    // Multiple image support.
    if (req.body.images !== undefined) {
      updates.images = req.body.images.map((image) => image.trim());

      updates.image = updates.images[0] || "";
    } else if (req.body.image !== undefined) {
      // Backward compatibility with single image.
      updates.image = req.body.image.trim();
      updates.images = updates.image ? [updates.image] : [];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields provided for update.",
      });
    }

    updates.updatedAt = new Date();

    const db = getDB();

    await db
      .collection("services")
      .updateOne({ _id: service._id }, { $set: updates });

    const updatedService = await db
      .collection("services")
      .findOne({ _id: service._id });

    return res.status(200).json({
      success: true,
      message: "Service updated successfully.",
      service: updatedService,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/v1/services/:id/availability
 * Vendor toggles their own service availability.
 */
router.patch("/:id/availability", requireVendor, async (req, res, next) => {
  try {
    const service = await loadOwnService(req, res);

    if (!service) return;

    if (typeof req.body.availability !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Send { availability: true } or { availability: false }.",
      });
    }
    if (req.body.availability === true) {
      const db = getDB();

      const vendor = await db.collection("user").findOne({
        _id: toId(req.user.id),
      });

      const subscription = vendor?.subscription;

      const isPremium =
        ["premium_monthly", "premium_yearly"].includes(subscription?.plan) &&
        subscription.status === "active" &&
        subscription.expiresAt &&
        new Date(subscription.expiresAt) > new Date();

      if (!isPremium) {
        const activeServices = await db.collection("services").countDocuments({
          vendorId: req.user.id,
          availability: true,
          _id: { $ne: service._id },
        });

        if (activeServices >= 3) {
          return res.status(403).json({
            success: false,
            message: "Free plan allows only 3 active services.",
            code: "SERVICE_LIMIT_REACHED",
          });
        }
      }
    }

    const db = getDB();

    await db.collection("services").updateOne(
      { _id: service._id },
      {
        $set: {
          availability: req.body.availability,
          updatedAt: new Date(),
        },
      },
    );

    return res.status(200).json({
      success: true,
      message: `Service is now ${
        req.body.availability ? "available" : "unavailable"
      }.`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/v1/services/:id
 * Vendor deletes own service; admin can delete any service.
 */
router.delete("/:id", authenticateUser, async (req, res, next) => {
  try {
    if (req.user.role === "admin") {
      // Admin can delete any service.
    } else if (req.user.role === "vendor" && req.user.vendorApproved === true) {
      const service = await loadOwnService(req, res);

      if (!service) return;
    } else {
      return res.status(403).json({
        success: false,
        message:
          "Access denied. Only approved vendors or admins can delete services.",
      });
    }

    const db = getDB();

    const result = await db.collection("services").deleteOne({
      _id: toId(req.params.id),
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Service not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Service deleted successfully.",
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/v1/services/:id/review
 * Admin approves or rejects a service.
 */
router.patch("/:id/review", requireAdmin, async (req, res, next) => {
  try {
    const { status } = req.body;

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be approved or rejected.",
      });
    }

    const db = getDB();

    const service = await db.collection("services").findOne({
      _id: toId(req.params.id),
    });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found.",
      });
    }

    await db.collection("services").updateOne(
      { _id: service._id },
      {
        $set: {
          status,
          updatedAt: new Date(),
        },
      },
    );

    const updatedService = await db
      .collection("services")
      .findOne({ _id: service._id });

    return res.status(200).json({
      success: true,
      message: `Service ${status} successfully.`,
      service: updatedService,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
