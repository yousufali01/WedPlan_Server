/**
 * Admin routes - every route requires an authenticated admin session.
 * Role changes and vendor approvals go through Better Auth's admin plugin
 * APIs, so all privilege checks are enforced server-side.
 */

import express from "express";
import { fromNodeHeaders } from "better-auth/node";

import { getAuth } from "../(auth)/auth.js";
import { getDB } from "../config/db.js";
import { requireAdmin } from "../(auth)/middleware.js";
import { sanitizeUser, toId } from "../utils/helpers.js";
import { isPremiumActive } from "../utils/subscription.js";
import { ObjectId } from "mongodb";

const router = express.Router();

const headers = (req) => fromNodeHeaders(req.headers);

/** GET /api/v1/admin/users - list users (paginated, searchable) */
router.get("/users", requireAdmin, async (req, res, next) => {
  try {
    const auth = getAuth();
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const result = await auth.api.listUsers({
      headers: headers(req),
      query: {
        limit,
        offset,
        sortBy: "createdAt",
        sortDirection: "desc",
      },
    });

    res.status(200).json({
      success: true,
      total: result.total,
      users: result.users.map(sanitizeUser),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/v1/admin/users/:id/role
 * Securely change a user's role.
 */
router.patch("/users/:id/role", requireAdmin, async (req, res, next) => {
  try {
    const { role } = req.body;
    const ALLOWED = ["customer", "vendor", "admin"];

    if (!ALLOWED.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `role must be one of: ${ALLOWED.join(", ")}.`,
      });
    }

    if (req.params.id === req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Admins cannot change their own role.",
      });
    }

    const auth = getAuth();

    const result = await auth.api.setRole({
      headers: headers(req),
      body: {
        userId: req.params.id,
        role,
      },
    });

    res.status(200).json({
      success: true,
      message: `User role updated to "${role}".`,
      user: sanitizeUser(result.user),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/v1/admin/vendors/:id/approval
 * Approve or reject a vendor.
 */
router.patch("/vendors/:id/approval", requireAdmin, async (req, res, next) => {
  try {
    const approved = req.body.approved;

    if (typeof approved !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Send { approved: true } or { approved: false }.",
      });
    }

    const db = getDB();

    const user = await db.collection("user").findOne({
      _id: toId(req.params.id),
      role: "vendor",
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found.",
      });
    }

    // Record the DECISION, not just the boolean:
    //  - approve            → "approved"
    //  - reject a pending   → "rejected"  (leaves the pending queue)
    //  - revoke an approval → "pending"   (returns to the pending queue)
    // Before this, rejection only wrote vendorApproved: false, which the
    // pending query (vendorApproved !== true) still matched, so the rejected
    // application instantly reappeared under "Pending Vendor Approvals".
    const wasApproved = user.vendorApproved === true;
    const vendorReviewStatus = approved
      ? "approved"
      : wasApproved
        ? "pending"
        : "rejected";

    await db.collection("user").updateOne(
      { _id: user._id },
      {
        $set: {
          vendorApproved: approved,
          vendorReviewStatus,
          updatedAt: new Date(),
        },
      },
    );

    // Keep the service catalog consistent with vendor approval
    await db.collection("services").updateMany(
      { vendorId: user._id.toHexString() },
      {
        $set: {
          availability: approved,
          updatedAt: new Date(),
        },
      },
    );

    res.status(200).json({
      success: true,
      message: approved
        ? "Vendor approved successfully."
        : "Vendor rejected. Their services are now hidden.",
      vendor: sanitizeUser({
        ...user,
        vendorApproved: approved,
        vendorReviewStatus,
      }),
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/v1/admin/vendors/pending */
router.get("/vendors/pending", requireAdmin, async (req, res, next) => {
  try {
    const db = getDB();

    const vendors = await db
      .collection("user")
      .find({
        role: "vendor",
        // Not approved yet...
        vendorApproved: { $ne: true },
        // ...and not already rejected by an admin (otherwise a rejected
        // application would sit in this queue forever).
        vendorReviewStatus: { $ne: "rejected" },
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      total: vendors.length,
      vendors: vendors.map(sanitizeUser),
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/v1/admin/services */
router.get("/services", requireAdmin, async (req, res, next) => {
  try {
    const db = getDB();

    const services = await db
      .collection("services")
      .find({})
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

/** POST /api/v1/admin/users/:id/ban */
router.post("/users/:id/ban", requireAdmin, async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(403).json({
        success: false,
        message: "You cannot block your own account.",
      });
    }

    const auth = getAuth();

    await auth.api.banUser({
      headers: headers(req),
      body: {
        userId: req.params.id,
        banReason:
          typeof req.body.reason === "string" ? req.body.reason : undefined,
      },
    });

    res.status(200).json({
      success: true,
      message: "User banned.",
    });
  } catch (error) {
    next(error);
  }
});

/** POST /api/v1/admin/users/:id/unban */
router.post("/users/:id/unban", requireAdmin, async (req, res, next) => {
  try {
    const auth = getAuth();

    await auth.api.unbanUser({
      headers: headers(req),
      body: {
        userId: req.params.id,
      },
    });

    res.status(200).json({
      success: true,
      message: "User unbanned.",
    });
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/v1/admin/users/:id */
router.delete("/users/:id", requireAdmin, async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Admins cannot delete their own account.",
      });
    }

    const auth = getAuth();

    await auth.api.removeUser({
      headers: headers(req),
      body: {
        userId: req.params.id,
      },
    });

    res.status(200).json({
      success: true,
      message: "User deleted.",
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/v1/admin/transactions */
router.get("/transactions", requireAdmin, async (req, res, next) => {
  try {
    const db = getDB();

    // 1. Fetch bookings
    const bookings = await db
      .collection("bookings")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    // 2. Fetch vendor subscriptions — they live in their OWN collection
    //    (`subscriptions`), NOT as a `subscription` field on the user doc.
    const subscriptions = await db
      .collection("subscriptions")
      .find({ plan: { $in: ["premium_monthly", "premium_yearly"] } })
      .sort({ createdAt: -1 })
      .toArray();

    // 3. Paid payment records = actual revenue collected.
    const paidPayments = await db
      .collection("subscriptionPayments")
      .find({ status: "paid" })
      .toArray();

    // Resolve vendor display names (vendorId may be ObjectId or string).
    const vendorIds = [
      ...new Set(subscriptions.map((s) => String(s.vendorId))),
    ];
    const vendorDocs = vendorIds.length
      ? await db
          .collection("user")
          .find({
            $or: vendorIds.flatMap((id) =>
              ObjectId.isValid(id)
                ? [{ _id: new ObjectId(id) }, { _id: id }]
                : [{ _id: id }],
            ),
          })
          .toArray()
      : [];
    const vendorById = new Map(
      vendorDocs.map((v) => [String(v._id), v]),
    );

    const transactions = [];

    // Map bookings
    for (const b of bookings) {
      transactions.push({
        id: b._id.toHexString(),
        type: "booking",
        title: b.serviceName || "Wedding Service Reservation",
        customer: b.customerName || b.customerId || "Couple",
        vendor: b.vendorId || "Vendor",
        amount:
          typeof b.servicePrice === "number"
            ? b.servicePrice
            : Number(b.price) || 0,
        currency: "BDT",
        status: b.status || "pending",
        date: b.createdAt || new Date(),
        eventDate: b.eventDate,
      });
    }

    // Map subscriptions
    for (const s of subscriptions) {
      const vendor = vendorById.get(String(s.vendorId));
      const isYearly = s.plan === "premium_yearly";

      transactions.push({
        id: `sub-${String(s._id)}`,
        type: "subscription",
        title: isYearly
          ? "Vendor Premium Yearly Membership"
          : "Vendor Premium Monthly Membership",
        customer: vendor?.name || vendor?.email || "Vendor",
        vendor: vendor?.businessName || vendor?.studioName || vendor?.name || "Vendor",
        amount: Number(s.amount) || (isYearly ? 290 : 29),
        currency: String(s.currency || "usd").toUpperCase(),
        status: s.status || "active",
        date: s.startedAt || s.createdAt || new Date(),
      });
    }

    transactions.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    const totalBookingValue = bookings
      .filter((b) => b.status === "accepted")
      .reduce((acc, curr) => acc + (Number(curr.servicePrice) || 0), 0);

    // Real revenue: every paid Stripe payment (renewals included).
    // Falls back to paid subscription docs if the payments collection is empty.
    let totalSubRevenue = paidPayments.reduce(
      (acc, p) => acc + (Number(p.amount) || 0),
      0,
    );

    if (paidPayments.length === 0) {
      totalSubRevenue = subscriptions
        .filter((s) => s.paymentStatus === "paid")
        .reduce((acc, s) => acc + (Number(s.amount) || 0), 0);
    }

    const activeSubscriptions = subscriptions.filter((s) =>
      isPremiumActive(s),
    ).length;

    res.status(200).json({
      success: true,
      total: transactions.length,
      transactions,
      summary: {
        totalBookingValue,
        totalSubRevenue,
        totalBookings: bookings.length,
        activeSubscriptions,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
