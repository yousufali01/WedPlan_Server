/**
 * Service routes.
 *  - Only APPROVED vendors can create/manage services.
 *  - Vendors can only modify their OWN services (ownership enforced on every write).
 *  - Admins can delete any service.
 *  - The public list only shows available services from approved vendors.
 */
const express = require("express");

const { getDB } = require("../config/db");
const {
  requireVendor,
  authenticateUser,
} = require("../middleware/auth");
const {
  toId,
  isNonEmptyString,
  isNonNegativeNumber,
} = require("../utils/helpers");

const router = express.Router();

/** Whitelisted, validated service fields - prevents mass assignment. */
const buildServiceData = (body, vendorId) => {
  const data = {
    vendorId,
    name: body.name.trim(),
    category: body.category.trim(),
    price: body.price,
    description: body.description ? String(body.description).trim() : "",
    location: body.location ? String(body.location).trim() : "",
    image: body.image ? String(body.image).trim() : "",
    availability: true,
  };
  return data;
};

/** Validates the request body for create/update. Returns an error message or null. */
const validateServiceBody = (body, { partial = false } = {}) => {
  if (!partial || body.name !== undefined) {
    if (!isNonEmptyString(body.name, 3, 100)) {
      return "Name is required (3-100 characters).";
    }
  }
  if (!partial || body.category !== undefined) {
    if (!isNonEmptyString(body.category, 2, 50)) {
      return "Category is required (2-50 characters).";
    }
  }
  if (!partial || body.price !== undefined) {
    if (!isNonNegativeNumber(body.price)) {
      return "Price is required and must be a non-negative number.";
    }
  }
  if (body.description !== undefined && typeof body.description !== "string") {
    return "Description must be a string.";
  }
  if (body.location !== undefined && typeof body.location !== "string") {
    return "Location must be a string.";
  }
  if (body.image !== undefined && typeof body.image !== "string") {
    return "Image must be a string.";
  }
  return null;
};

/** POST /api/v1/services - vendor creates a service (vendorId is taken from the session) */
router.post("/", requireVendor, async (req, res, next) => {
  try {
    const error = validateServiceBody(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: error });
    }

    const db = getDB();
    const now = new Date();

    const result = await db.collection("services").insertOne({
      ...buildServiceData(req.body, req.user.id),
      createdAt: now,
      updatedAt: now,
    });

    const service = await db
      .collection("services")
      .findOne({ _id: result.insertedId });

    res.status(201).json({
      success: true,
      message: "Service created successfully.",
      service,
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/v1/services - public list of available services from approved vendors */
router.get("/", async (req, res, next) => {
  try {
    const db = getDB();

    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

    const query = { availability: true };
    if (req.query.category) {
      query.category = String(req.query.category).trim();
    }

    // Only services owned by APPROVED vendors
    const approvedVendors = await db
      .collection("user")
      .find({ role: "vendor", vendorApproved: true })
      .project({ _id: 1 })
      .toArray();

    query.vendorId = {
      $in: approvedVendors.map((vendor) => vendor._id.toHexString()),
    };

    const total = await db.collection("services").countDocuments(query);

    const services = await db
      .collection("services")
      .find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray();

    res.status(200).json({
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

/** GET /api/v1/services/mine - vendor's own services (all, including unavailable) */
router.get("/mine", requireVendor, async (req, res, next) => {
  try {
    const db = getDB();

    const services = await db
      .collection("services")
      .find({ vendorId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      total: services.length,
      services,
    });
  } catch (error) {
    next(error);
  }
});

/** Loads a service and verifies the vendor owns it (or caller is admin). */
const loadOwnService = async (req, res) => {
  const db = getDB();
  const service = await db
    .collection("services")
    .findOne({ _id: toId(req.params.id) });

  if (!service) {
    res.status(404).json({ success: false, message: "Service not found." });
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

/** PATCH /api/v1/services/:id - vendor updates own service */
router.patch("/:id", requireVendor, async (req, res, next) => {
  try {
    const service = await loadOwnService(req, res);
    if (!service) return;

    const error = validateServiceBody(req.body, { partial: true });
    if (error) {
      return res.status(400).json({ success: false, message: error });
    }

    // Only whitelisted fields are ever applied - the body cannot touch vendorId
    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name.trim();
    if (req.body.category !== undefined)
      updates.category = req.body.category.trim();
    if (req.body.price !== undefined) updates.price = req.body.price;
    if (req.body.description !== undefined)
      updates.description = String(req.body.description).trim();
    if (req.body.location !== undefined)
      updates.location = String(req.body.location).trim();
    if (req.body.image !== undefined)
      updates.image = String(req.body.image).trim();

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Nothing to update.",
      });
    }

    const db = getDB();
    await db
      .collection("services")
      .updateOne(
        { _id: service._id },
        { $set: { ...updates, updatedAt: new Date() } }
      );

    const updated = await db
      .collection("services")
      .findOne({ _id: service._id });

    res.status(200).json({
      success: true,
      message: "Service updated successfully.",
      service: updated,
    });
  } catch (error) {
    next(error);
  }
});

/** PATCH /api/v1/services/:id/availability - vendor toggles own service availability */
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

    const db = getDB();
    await db
      .collection("services")
      .updateOne(
        { _id: service._id },
        { $set: { availability: req.body.availability, updatedAt: new Date() } }
      );

    res.status(200).json({
      success: true,
      message: `Service is now ${req.body.availability ? "available" : "unavailable"}.`,
    });
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/v1/services/:id - vendor deletes own service, admin deletes any */
router.delete("/:id", authenticateUser, async (req, res, next) => {
  try {
    if (req.user.role === "admin") {
      // Admin may delete any service
    } else if (req.user.role === "vendor" && req.user.vendorApproved === true) {
      // Vendor may delete only their own service
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
    const result = await db
      .collection("services")
      .deleteOne({ _id: toId(req.params.id) });

    if (result.deletedCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Service not found." });
    }

    res.status(200).json({
      success: true,
      message: "Service deleted successfully.",
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
