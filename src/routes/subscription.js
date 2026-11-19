const express = require("express");
const Stripe = require("stripe");
const { getDB } = require("../config/db");
const { requireVendor } = require("../middleware/auth");
const { toId } = require("../utils/helpers");

const router = express.Router();

let stripe = null;
const getStripe = () => {
  if (!stripe) {
    const key =
      process.env.STRIPE_SECRET_KEY ||
      process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY ||
      "";
    if (key) {
      stripe = new Stripe(key);
    }
  }
  return stripe;
};

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
  const vIdStr = String(vendorId);
  return db.collection("services").countDocuments({
    $or: [{ vendorId: vIdStr }, { vendorId: toId(vIdStr) }],
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
    const vendorId = req.user.id || String(req.user._id || "");

    const vendor = await db.collection("user").findOne({
      $or: [{ _id: toId(vendorId) }, { id: vendorId }],
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
    const activeServices = await getActiveServiceCount(db, vendorId);

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

// POST /api/v1/subscription/create-checkout-session
router.post("/create-checkout-session", requireVendor, async (req, res, next) => {
  try {
    const stripeInstance = getStripe();
    if (!stripeInstance) {
      return res.status(500).json({
        success: false,
        message: "Stripe secret key is not configured on the server.",
      });
    }

    const { planId } = req.body;
    const plan = planId === "premium_yearly" ? "premium_yearly" : "premium_monthly";
    const planInfo = PLANS[plan];

    const frontendUrl =
      process.env.FRONTEND_URL ||
      req.headers.origin ||
      "http://localhost:3000";

    const vendorId = req.user.id || String(req.user._id || "");

    const session = await stripeInstance.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `WedPlan ${planInfo.name}`,
              description: `Upgrade to ${planInfo.name} for unlimited listings and wedding features.`,
            },
            unit_amount: planInfo.price * 100,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      customer_email: req.user.email || undefined,
      metadata: {
        vendorId,
        planId: plan,
      },
      success_url: `${frontendUrl}/vendor/subscription?success=true&session_id={CHECKOUT_SESSION_ID}&plan=${plan}`,
      cancel_url: `${frontendUrl}/vendor/subscription?canceled=true`,
    });

    res.json({
      success: true,
      url: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/subscription/verify-stripe-session
router.post("/verify-stripe-session", requireVendor, async (req, res, next) => {
  try {
    const { sessionId, plan: requestedPlan } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: "sessionId is required.",
      });
    }

    const stripeInstance = getStripe();
    let isPaid = false;
    let sessionPlan = requestedPlan || "premium_monthly";
    let amountTotal = 0;

    if (stripeInstance) {
      try {
        const session = await stripeInstance.checkout.sessions.retrieve(sessionId);
        if (session) {
          isPaid =
            session.payment_status === "paid" ||
            session.status === "complete" ||
            session.payment_status === "no_payment_required";

          if (session.metadata?.planId) {
            sessionPlan = session.metadata.planId;
          }
          amountTotal = session.amount_total ? session.amount_total / 100 : 0;
        }
      } catch (stripeErr) {
        console.error("Stripe session retrieval error:", stripeErr);
      }
    } else {
      isPaid = Boolean(sessionId);
    }

    if (!isPaid) {
      return res.status(400).json({
        success: false,
        message: "Payment could not be verified with Stripe.",
      });
    }

    const plan = sessionPlan === "premium_yearly" ? "premium_yearly" : "premium_monthly";
    const db = getDB();
    const now = new Date();
    const endDate = new Date(now);

    if (plan === "premium_yearly") {
      endDate.setFullYear(endDate.getFullYear() + 1);
    } else {
      endDate.setMonth(endDate.getMonth() + 1);
    }

    const subscription = {
      plan,
      status: "active",
      startedAt: now,
      expiresAt: endDate,
      paymentStatus: "paid",
      stripeSessionId: sessionId,
      amountPaid: amountTotal || (PLANS[plan] ? PLANS[plan].price : 29),
      updatedAt: now,
    };

    const vendorId = req.user.id || String(req.user._id || "");
    await db.collection("user").updateOne(
      { $or: [{ _id: toId(vendorId) }, { id: vendorId }] },
      { $set: { subscription } }
    );

    res.json({
      success: true,
      message: "Subscription successfully upgraded to Premium!",
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

// POST /api/v1/subscription/upgrade
router.post("/upgrade", requireVendor, async (req, res, next) => {
  try {
    const { plan, sessionId } = req.body;

    if (!["premium_monthly", "premium_yearly"].includes(plan)) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription plan.",
      });
    }

    // If sessionId provided, delegate to verify
    if (sessionId) {
      req.body.sessionId = sessionId;
      req.body.plan = plan;
      return router.handle(req, res, next);
    }

    // Require Stripe Checkout payment
    return res.status(402).json({
      success: false,
      message: "Payment is required to activate a Premium plan. Please proceed through Stripe checkout.",
      requiresPayment: true,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/subscription/downgrade - return to the Free plan.
router.post("/downgrade", requireVendor, async (req, res, next) => {
  try {
    const db = getDB();
    const subscription = {
      plan: "free",
      status: "active",
      startedAt: new Date(),
      paymentStatus: "free",
      updatedAt: new Date(),
    };

    const vendorId = req.user.id || String(req.user._id || "");
    const result = await db.collection("user").updateOne(
      { $or: [{ _id: toId(vendorId) }, { id: vendorId }] },
      { $set: { subscription } }
    );

    if (!result.matchedCount) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found.",
      });
    }

    res.json({
      success: true,
      message: "Switched to the Free plan.",
      subscription: {
        ...subscription,
        planName: PLANS.free.name,
        price: PLANS.free.price,
        interval: PLANS.free.interval,
        activeServiceLimit: PLANS.free.activeServiceLimit,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
