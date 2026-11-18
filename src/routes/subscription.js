const express = require("express");
const { getDB } = require("../config/db");
const { requireVendor } = require("../middleware/auth");
const { toId } = require("../utils/helpers");

const router = express.Router();

const PLANS = {
  free: {
    name: "Free",
    price: 0,
    interval: "month",
    activeServiceLimit: 3,
  },
  premium_monthly: {
    name: "Premium Monthly",
    price: 29,
    interval: "month",
    activeServiceLimit: null,
  },
  premium_yearly: {
    name: "Premium Yearly",
    price: 290,
    interval: "year",
    activeServiceLimit: null,
  },
};

const getActiveServiceCount = async (db, vendorId) => {
  return db.collection("services").countDocuments({
    vendorId,
    availability: true,
  });
};

// GET /api/v1/subscription/plans
router.get("/plans", (req, res) => {
  res.json({
    success: true,
    plans: PLANS,
  });
});

// GET /api/v1/subscription/mine
router.get("/mine", requireVendor, async (req, res, next) => {
  try {
    const db = getDB();

    const vendor = await db.collection("user").findOne({
      _id: toId(req.user.id),
    });

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found.",
      });
    }

    const subscription = vendor.subscription || {
      plan: "free",
      status: "active",
    };

    const plan = PLANS[subscription.plan] || PLANS.free;

    const activeServices = await getActiveServiceCount(db, req.user.id);

    res.json({
      success: true,
      subscription: {
        ...subscription,
        planName: plan.name,
        price: plan.price,
        interval: plan.interval,
        activeServiceLimit: plan.activeServiceLimit,
        activeServices,
        remainingServices:
          plan.activeServiceLimit === null
            ? null
            : Math.max(0, plan.activeServiceLimit - activeServices),
      },
      plans: PLANS,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/subscription/upgrade
// Demo activation only. No real payment is collected.
router.post("/upgrade", requireVendor, async (req, res, next) => {
  try {
    const { plan } = req.body;

    if (!["premium_monthly", "premium_yearly"].includes(plan)) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription plan.",
      });
    }

    const db = getDB();

    const now = new Date();
    const endDate = new Date(now);

    if (plan === "premium_monthly") {
      endDate.setMonth(endDate.getMonth() + 1);
    } else {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    const subscription = {
      plan,
      status: "active",
      startedAt: now,
      expiresAt: endDate,
      paymentStatus: "demo",
      updatedAt: now,
    };

    const result = await db.collection("user").updateOne(
      { _id: toId(req.user.id) },
      {
        $set: {
          subscription,
        },
      },
    );

    if (!result.matchedCount) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found.",
      });
    }

    res.json({
      success: true,
      message: "Premium plan activated successfully (demo).",
      subscription: {
        ...subscription,
        planName: PLANS[plan].name,
        price: PLANS[plan].price,
        interval: PLANS[plan].interval,
        activeServiceLimit: null,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
