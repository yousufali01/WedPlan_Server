/**
 * Booking routes.
 *  - Customers create bookings on available services of approved vendors.
 *  - Customers see/cancel only THEIR OWN bookings.
 *  - Vendors see bookings for THEIR OWN services and can accept/reject pending ones.
 *  - Admins can view all bookings and update any booking status.
 */
const express = require("express");

const { getDB } = require("../config/db");
const {
  requireCustomer,
  requireVendor,
  requireAdmin,
  authenticateUser,
} = require("../middleware/auth");
const { toId, isNonEmptyString } = require("../utils/helpers");

const router = express.Router();

const BOOKING_STATUSES = ["pending", "accepted", "rejected", "cancelled"];

const isFutureDate = (value) => {
  if (!isNonEmptyString(value, 8, 40)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() > Date.now();
};

/** POST /api/v1/bookings - customer creates a booking */
router.post("/", requireCustomer, async (req, res, next) => {
  try {
    if (!isNonEmptyString(req.body.serviceId, 1, 64)) {
      return res
        .status(400)
        .json({ success: false, message: "serviceId is required." });
    }
    if (!isFutureDate(req.body.eventDate)) {
      return res.status(400).json({
        success: false,
        message: "eventDate is required and must be a valid future date.",
      });
    }
    if (
      req.body.guestCount !== undefined &&
      (!Number.isInteger(req.body.guestCount) || req.body.guestCount < 1)
    ) {
      return res.status(400).json({
        success: false,
        message: "guestCount must be a positive integer.",
      });
    }

    const db = getDB();

    // The service must exist, be available and belong to an APPROVED vendor.
    // vendorId is taken from the service itself - never from the request body.
    const service = await db
      .collection("services")
      .findOne({ _id: toId(req.body.serviceId), availability: true });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found or not available.",
      });
    }

    const vendor = await db.collection("user").findOne({
      _id: toId(service.vendorId),
      role: "vendor",
      vendorApproved: true,
    });

    if (!vendor) {
      return res.status(400).json({
        success: false,
        message: "This service is currently not bookable.",
      });
    }

    const now = new Date();
    const result = await db.collection("bookings").insertOne({
      customerId: req.user.id,
      vendorId: service.vendorId,
      serviceId: service._id.toHexString(),
      serviceName: service.name,
      servicePrice: service.price,
      eventDate: req.body.eventDate.trim(),
      guestCount: req.body.guestCount ?? null,
      notes: typeof req.body.notes === "string" ? req.body.notes.trim() : "",
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    const booking = await db
      .collection("bookings")
      .findOne({ _id: result.insertedId });

    res.status(201).json({
      success: true,
      message: "Booking created successfully. Waiting for vendor response.",
      booking,
    });
  } catch (error) {
    next(error);
  }
});

/** Customer booking view: only the booking owner or the owning vendor can see it. */
const loadParticipantBooking = async (req, res) => {
  const db = getDB();
  const booking = await db
    .collection("bookings")
    .findOne({ _id: toId(req.params.id) });

  if (!booking) {
    res.status(404).json({ success: false, message: "Booking not found." });
    return null;
  }

  const isCustomer = booking.customerId === req.user.id;
  const isVendor = booking.vendorId === req.user.id;
  const isAdmin = req.user.role === "admin";

  if (!isCustomer && !isVendor && !isAdmin) {
    res.status(403).json({
      success: false,
      message: "Access denied. This booking does not belong to you.",
    });
    return null;
  }

  return booking;
};

/** GET /api/v1/bookings/mine - customer's own bookings */
router.get("/mine", requireCustomer, async (req, res, next) => {
  try {
    const db = getDB();
    const bookings = await db
      .collection("bookings")
      .find({ customerId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({ success: true, total: bookings.length, bookings });
  } catch (error) {
    next(error);
  }
});

/** GET /api/v1/bookings/vendor - bookings for the vendor's own services */
router.get("/vendor", requireVendor, async (req, res, next) => {
  try {
    const db = getDB();
    const bookings = await db
      .collection("bookings")
      .find({ vendorId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({ success: true, total: bookings.length, bookings });
  } catch (error) {
    next(error);
  }
});

/** GET /api/v1/bookings - admin views all bookings */
router.get("/", requireAdmin, async (req, res, next) => {
  try {
    const db = getDB();

    const query = {};
    if (req.query.status && BOOKING_STATUSES.includes(req.query.status)) {
      query.status = req.query.status;
    }

    const total = await db.collection("bookings").countDocuments(query);
    const bookings = await db
      .collection("bookings")
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({ success: true, total, bookings });
  } catch (error) {
    next(error);
  }
});

/** GET /api/v1/bookings/:id - booking details (owner customer, owning vendor or admin) */
router.get("/:id", authenticateUser, async (req, res, next) => {
  try {
    const booking = await loadParticipantBooking(req, res);
    if (!booking) return;

    // Customers never see other customers' private information in vendor context
    res.status(200).json({ success: true, booking });
  } catch (error) {
    next(error);
  }
});

/** PATCH /api/v1/bookings/:id/cancel - customer cancels own pending booking */
router.patch("/:id/cancel", requireCustomer, async (req, res, next) => {
  try {
    const booking = await loadParticipantBooking(req, res);
    if (!booking) return;

    if (booking.customerId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only cancel your own bookings.",
      });
    }

    if (booking.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: `Only pending bookings can be cancelled (current status: ${booking.status}).`,
      });
    }

    const db = getDB();
    await db
      .collection("bookings")
      .updateOne(
        { _id: booking._id },
        { $set: { status: "cancelled", updatedAt: new Date() } }
      );

    res.status(200).json({
      success: true,
      message: "Booking cancelled successfully.",
    });
  } catch (error) {
    next(error);
  }
});

/** PATCH /api/v1/bookings/:id/status - vendor (own bookings) or admin (any) */
router.patch("/:id/status", authenticateUser, async (req, res, next) => {
  try {
    const status = req.body.status;

    if (!BOOKING_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `status must be one of: ${BOOKING_STATUSES.join(", ")}.`,
      });
    }

    const booking = await loadParticipantBooking(req, res);
    if (!booking) return;

    const isVendor = req.user.role === "vendor" && booking.vendorId === req.user.id;
    const isAdmin = req.user.role === "admin";

    if (!isVendor && !isAdmin) {
      return res.status(403).json({
        success: false,
        message:
          "Access denied. Only the owning vendor or an admin can change booking status.",
      });
    }

    // Vendors may only accept or reject PENDING bookings; admins can set any status.
    if (isVendor) {
      if (!["accepted", "rejected"].includes(status)) {
        return res.status(403).json({
          success: false,
          message: "Vendors can only accept or reject bookings.",
        });
      }
      if (booking.status !== "pending") {
        return res.status(400).json({
          success: false,
          message: `Only pending bookings can be accepted or rejected (current status: ${booking.status}).`,
        });
      }
    }

    const db = getDB();
    await db
      .collection("bookings")
      .updateOne(
        { _id: booking._id },
        { $set: { status, updatedAt: new Date() } }
      );

    res.status(200).json({
      success: true,
      message: `Booking ${status}.`,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
