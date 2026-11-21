
import { Router } from "express";
import Stripe from "stripe";
import { ObjectId } from "mongodb";

import { getDB } from "../config/db.js";
import { requireVendor } from "../(auth)/middleware.js";

import {
  PREMIUM_PLANS,
  isPremiumActive,
} from "../utils/subscription.js";

const router = Router();

/* ================= STRIPE CONFIGURATION ================= */

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY is missing.");
}

if (!process.env.CLIENT_URL) {
  throw new Error("CLIENT_URL is missing.");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const CLIENT_URL = process.env.CLIENT_URL.replace(/\/+$/, "");

/* ================= PLAN CONFIGURATION ================= */

const PLANS = {
  free: {
    id: "free",
    name: "Free",
    amount: 0,
    currency: "usd",
    durationDays: 0,
  },

  premium_monthly: {
    id: "premium_monthly",
    name: "Premium Monthly",
    amount: Number(process.env.STRIPE_MONTHLY_PRICE),
    currency: "usd",
    durationDays: 30,
  },

  premium_yearly: {
    id: "premium_yearly",
    name: "Premium Yearly",
    amount: Number(process.env.STRIPE_YEARLY_PRICE),
    currency: "usd",
    durationDays: 365,
  },
};

const validatePlan = (planId) => {
  const plan = PLANS[planId];

  if (!plan) {
    throw new Error("Invalid subscription plan.");
  }

  if (
    planId !== "free" &&
    (!Number.isFinite(plan.amount) || plan.amount <= 0)
  ) {
    throw new Error("Subscription price is not configured.");
  }

  return plan;
};

/* ================= HELPERS ================= */

const getVendorId = (req) => {
  const id = req.user?._id || req.user?.id;

  if (!id) {
    throw new Error("Vendor ID not found.");
  }

  return id;
};

const getVendorFilter = (vendorId) => {
  if (vendorId instanceof ObjectId) {
    return { vendorId };
  }

  if (ObjectId.isValid(String(vendorId))) {
    return {
      $or: [
        { vendorId: String(vendorId) },
        { vendorId: new ObjectId(String(vendorId)) },
      ],
    };
  }

  return { vendorId: String(vendorId) };
};

const getSubscription = async (db, vendorId) => {
  return db.collection("subscriptions").findOne(
    getVendorFilter(vendorId),
    { sort: { createdAt: -1 } },
  );
};

const buildSubscriptionResponse = (subscription) => {
  if (!subscription) {
    return {
      plan: "free",
      status: "inactive",
      paymentStatus: "unpaid",
      expiresAt: null,
      isPremium: false,
      subscription: null,
    };
  }

  return {
    plan: subscription.plan || "free",
    status: subscription.status || "inactive",
    paymentStatus: subscription.paymentStatus || "unpaid",
    expiresAt: subscription.expiresAt || null,
    isPremium: isPremiumActive(subscription),
    subscription,
  };
};

const getCheckoutUrls = () => ({
  success_url: `${CLIENT_URL}/vendor/subscription?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${CLIENT_URL}/vendor/subscription?payment=cancelled`,
});

/* ================= GET PLANS ================= */

router.get("/plans", (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      plans: Object.values(PLANS),
    });
  } catch (error) {
    console.error("Plans error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch plans.",
    });
  }
});

/* ================= GET MY SUBSCRIPTION ================= */

router.get("/mine", requireVendor, async (req, res) => {
  try {
    const db = getDB();
    const vendorId = getVendorId(req);

    const subscription = await getSubscription(db, vendorId);

    return res.status(200).json({
      success: true,
      ...buildSubscriptionResponse(subscription),
    });
  } catch (error) {
    console.error("Get subscription error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch subscription.",
    });
  }
});

/* ================= CREATE CHECKOUT SESSION ================= */

const createSubscriptionCheckout = async (req, res) => {
  try {
    const vendorId = getVendorId(req);
    const { planId } = req.body;

    if (!PREMIUM_PLANS.includes(planId)) {
      return res.status(400).json({
        success: false,
        message: "Please select a valid premium plan.",
      });
    }

    const plan = validatePlan(planId);
    const db = getDB();

    const session = await stripe.checkout.sessions.create({
      mode: "payment",

      line_items: [
        {
          price_data: {
            currency: plan.currency,

            product_data: {
              name: `WedPlan ${plan.name}`,
              description: `${plan.name} subscription`,
            },

            unit_amount: Math.round(plan.amount * 100),
          },

          quantity: 1,
        },
      ],

      metadata: {
        vendorId: String(vendorId),
        planId: plan.id,
      },

      success_url: getCheckoutUrls().success_url,
      cancel_url: getCheckoutUrls().cancel_url,
    });

    await db.collection("subscriptionPayments").updateOne(
      { stripeSessionId: session.id },
      {
        $setOnInsert: {
          vendorId,
          plan: plan.id,
          stripeSessionId: session.id,
          amount: plan.amount,
          currency: plan.currency,
          status: "pending",
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );

    return res.status(200).json({
      success: true,
      message: "Checkout session created successfully.",
      checkoutUrl: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    console.error("Create checkout session error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Checkout failed.",
    });
  }
};

router.post(
  "/create-checkout-session",
  requireVendor,
  createSubscriptionCheckout,
);

router.post("/upgrade", requireVendor, createSubscriptionCheckout);

/* ================= VERIFY CHECKOUT PAYMENT ================= */

router.post("/verify-stripe-session", requireVendor, async (req, res) => {
  try {
    const vendorId = getVendorId(req);
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: "Stripe session ID is required.",
      });
    }

    const db = getDB();

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (String(session.metadata?.vendorId) !== String(vendorId)) {
      return res.status(403).json({
        success: false,
        message: "Invalid checkout session owner.",
      });
    }

    if (
      session.mode !== "payment" ||
      session.payment_status !== "paid"
    ) {
      return res.status(400).json({
        success: false,
        message: "Payment has not been completed.",
      });
    }

    const planId = session.metadata?.planId;

    if (!planId || !PREMIUM_PLANS.includes(planId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription plan.",
      });
    }

    const plan = validatePlan(planId);

    if (
      session.currency !== plan.currency ||
      session.amount_total !== Math.round(plan.amount * 100)
    ) {
      return res.status(400).json({
        success: false,
        message: "Payment amount verification failed.",
      });
    }

    const paymentCollection = db.collection("subscriptionPayments");

    const existingPayment = await paymentCollection.findOne({
      stripeSessionId: session.id,
      ...getVendorFilter(vendorId),
    });

    if (!existingPayment) {
      return res.status(400).json({
        success: false,
        message: "Payment record not found.",
      });
    }

    if (existingPayment.status === "paid") {
      const existingSubscription = await db
        .collection("subscriptions")
        .findOne({
          stripeSessionId: session.id,
          ...getVendorFilter(vendorId),
        });

      return res.status(200).json({
        success: true,
        message: "Payment already verified.",
        subscription: buildSubscriptionResponse(existingSubscription),
      });
    }

    const now = new Date();

    const expiresAt = new Date(
      now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000,
    );

    const subscriptionData = {
      vendorId,
      plan: plan.id,
      status: "active",
      paymentStatus: "paid",
      stripeSessionId: session.id,

      stripePaymentIntentId:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id || null,

      amount: session.amount_total / 100,
      currency: session.currency,
      startedAt: now,
      expiresAt,
      cancelAtPeriodEnd: false,
      createdAt: now,
      updatedAt: now,
    };

    await db.collection("subscriptions").updateOne(
      {
        stripeSessionId: session.id,
        ...getVendorFilter(vendorId),
      },
      {
        $set: subscriptionData,
      },
      { upsert: true },
    );

    await paymentCollection.updateOne(
      {
        stripeSessionId: session.id,
        ...getVendorFilter(vendorId),
      },
      {
        $set: {
          status: "paid",
          paymentIntentId: subscriptionData.stripePaymentIntentId,
          updatedAt: now,
        },
      },
    );

    return res.status(200).json({
      success: true,
      message: "Subscription activated successfully.",
      subscription: buildSubscriptionResponse(subscriptionData),
    });
  } catch (error) {
    console.error("Verify payment error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Payment verification failed.",
    });
  }
});

/* ================= PAYMENT METHODS ================= */

router.get("/payment-methods", requireVendor, async (req, res) => {
  try {
    const db = getDB();
    const vendorId = getVendorId(req);

    const vendor = await db.collection("user").findOne({
      _id: vendorId instanceof ObjectId
        ? vendorId
        : ObjectId.isValid(String(vendorId))
          ? new ObjectId(String(vendorId))
          : vendorId,
    });

    if (!vendor?.stripeCustomerId) {
      return res.status(200).json({
        success: true,
        paymentMethods: [],
      });
    }

    const methods = await stripe.paymentMethods.list({
      customer: vendor.stripeCustomerId,
      type: "card",
    });

    return res.status(200).json({
      success: true,
      paymentMethods: methods.data.map((method) => ({
        id: method.id,
        brand: method.card?.brand,
        last4: method.card?.last4,
        expMonth: method.card?.exp_month,
        expYear: method.card?.exp_year,
      })),
    });
  } catch (error) {
    console.error("Payment methods error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch payment methods.",
    });
  }
});

/* ================= DOWNGRADE ================= */

router.post("/downgrade", requireVendor, async (req, res) => {
  try {
    const db = getDB();
    const vendorId = getVendorId(req);

    const subscription = await getSubscription(db, vendorId);

    if (!subscription || !isPremiumActive(subscription)) {
      return res.status(400).json({
        success: false,
        message: "No active premium subscription.",
      });
    }

    await db.collection("subscriptions").updateOne(
      { _id: subscription._id },
      {
        $set: {
          cancelAtPeriodEnd: true,
          updatedAt: new Date(),
        },
      },
    );

    return res.status(200).json({
      success: true,
      message: "Subscription cancellation scheduled.",
    });
  } catch (error) {
    console.error("Downgrade error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to downgrade subscription.",
    });
  }
});

/* ================= DIRECT PAYMENT ================= */

router.post("/pay", requireVendor, async (req, res) => {
  try {
    const vendorId = getVendorId(req);
    const { planId, paymentMethodId } = req.body;

    if (!PREMIUM_PLANS.includes(planId) || !paymentMethodId) {
      return res.status(400).json({
        success: false,
        message: "Valid plan and payment method are required.",
      });
    }

    const plan = validatePlan(planId);
    const db = getDB();

    const vendor = await db.collection("user").findOne({
      _id: vendorId instanceof ObjectId
        ? vendorId
        : ObjectId.isValid(String(vendorId))
          ? new ObjectId(String(vendorId))
          : vendorId,
    });

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor account not found.",
      });
    }

    let customerId = vendor.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: vendor.email,
        name: vendor.name,
        metadata: {
          vendorId: String(vendorId),
        },
      });

      customerId = customer.id;

      await db.collection("user").updateOne(
        { _id: vendor._id },
        {
          $set: {
            stripeCustomerId: customerId,
            updatedAt: new Date(),
          },
        },
      );
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(plan.amount * 100),
      currency: plan.currency,
      customer: customerId,
      payment_method: paymentMethodId,
      confirm: true,
      off_session: true,

      metadata: {
        vendorId: String(vendorId),
        planId: plan.id,
      },
    });

    if (paymentIntent.status !== "succeeded") {
      return res.status(400).json({
        success: false,
        message: "Payment was not successful.",
        paymentStatus: paymentIntent.status,
      });
    }

    const now = new Date();

    const subscriptionData = {
      vendorId,
      plan: plan.id,
      status: "active",
      paymentStatus: "paid",
      paymentIntentId: paymentIntent.id,
      amount: plan.amount,
      currency: plan.currency,
      startedAt: now,
      expiresAt: new Date(
        now.getTime() + plan.durationDays * 86400000,
      ),
      cancelAtPeriodEnd: false,
      createdAt: now,
      updatedAt: now,
    };

    await db.collection("subscriptions").insertOne(subscriptionData);

    await db.collection("subscriptionPayments").insertOne({
      vendorId,
      plan: plan.id,
      paymentIntentId: paymentIntent.id,
      amount: plan.amount,
      currency: plan.currency,
      status: "paid",
      createdAt: now,
    });

    return res.status(200).json({
      success: true,
      message: "Payment successful.",
      subscription: buildSubscriptionResponse(subscriptionData),
    });
  } catch (error) {
    console.error("Direct payment error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Payment failed.",
    });
  }
});

export default router;
