import { Router } from "express";
import Stripe from "stripe";
import { ObjectId } from "mongodb";

import { getDB } from "../config/db.js";
import { requireVendor } from "../(auth)/middleware.js";

import {
  PREMIUM_PLANS,
  isPremiumActive,
}from "../utils/subscription.js";
const router = Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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
  return db
    .collection("subscriptions")
    .findOne(getVendorFilter(vendorId), { sort: { createdAt: -1 } });
};

const buildSubscriptionResponse = (subscription) => {
  if (!subscription) {
    return {
      plan: "free",
      status: "inactive",
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

const getPlan = (planId) => {
  const plan = PLANS[planId];

  if (!plan) {
    throw new Error("Invalid subscription plan.");
  }

  return plan;
};

const createSubscriptionCheckout = async (req, res) => {
  try {
    const vendorId = getVendorId(req);
    const { planId } = req.body;

    if (!planId || !PREMIUM_PLANS.includes(planId)) {
      return res.status(400).json({
        success: false,
        message: "Please select a valid premium plan.",
      });
    }

    const plan = getPlan(planId);

    if (!Number.isFinite(plan.amount) || plan.amount <= 0) {
      return res.status(500).json({
        success: false,
        message: "Subscription price is not configured.",
      });
    }

    const db = getDB();

    const session = await stripe.checkout.sessions.create({
      mode: "payment",

      payment_method_types: ["card"],

      line_items: [
        {
          price_data: {
            currency: plan.currency,
            product_data: {
              name: plan.name,
              description: `WedPlan ${plan.name} subscription`,
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

      success_url: `${process.env.CLIENT_URL}/vendor/subscription?session_id={CHECKOUT_SESSION_ID}`,

      cancel_url: `${process.env.CLIENT_URL}/vendor/subscription?payment=cancelled`,
    });

    await db.collection("subscriptionPayments").insertOne({
      vendorId,
      plan: plan.id,
      stripeSessionId: session.id,
      amount: plan.amount,
      currency: plan.currency,
      status: "pending",
      createdAt: new Date(),
    });

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
      message: error.message || "Failed to create checkout session.",
    });
  }
};

// GET /plans
router.get("/plans", (req, res) => {
  return res.status(200).json({
    success: true,
    plans: Object.values(PLANS),
  });
});

// GET /mine
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

// GET /payment-methods
router.get("/payment-methods", requireVendor, async (req, res) => {
  try {
    const db = getDB();
    const vendorId = getVendorId(req);

    const vendor = await db
      .collection("user")
      .findOne(getVendorFilter(vendorId));

    const customerId = vendor?.stripeCustomerId;

    if (!customerId) {
      return res.status(200).json({
        success: true,
        paymentMethods: [],
      });
    }

    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: "card",
    });

    const safePaymentMethods = paymentMethods.data.map((method) => ({
      id: method.id,
      brand: method.card?.brand,
      last4: method.card?.last4,
      expMonth: method.card?.exp_month,
      expYear: method.card?.exp_year,
    }));

    return res.status(200).json({
      success: true,
      paymentMethods: safePaymentMethods,
    });
  } catch (error) {
    console.error("Get payment methods error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch payment methods.",
    });
  }
});

// POST /create-checkout-session
router.post(
  "/create-checkout-session",
  requireVendor,
  createSubscriptionCheckout,
);

// POST /upgrade
router.post("/upgrade", requireVendor, createSubscriptionCheckout);

// POST /downgrade
router.post("/downgrade", requireVendor, async (req, res) => {
  try {
    const db = getDB();
    const vendorId = getVendorId(req);

    const subscription = await getSubscription(db, vendorId);

    if (!subscription || !isPremiumActive(subscription)) {
      return res.status(400).json({
        success: false,
        message: "You do not have an active premium subscription.",
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
      message: "Subscription will not renew after the current period.",
    });
  } catch (error) {
    console.error("Downgrade subscription error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to downgrade subscription.",
    });
  }
});

// POST /pay
router.post("/pay", requireVendor, async (req, res) => {
  try {
    const vendorId = getVendorId(req);
    const { planId, paymentMethodId } = req.body;

    if (!planId || !PREMIUM_PLANS.includes(planId)) {
      return res.status(400).json({
        success: false,
        message: "Please select a valid premium plan.",
      });
    }

    if (!paymentMethodId) {
      return res.status(400).json({
        success: false,
        message: "Payment method is required.",
      });
    }

    const plan = getPlan(planId);

    if (!Number.isFinite(plan.amount) || plan.amount <= 0) {
      return res.status(500).json({
        success: false,
        message: "Subscription price is not configured.",
      });
    }

    const db = getDB();

    const vendor = await db
      .collection("user")
      .findOne(getVendorFilter(vendorId));

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

      await db.collection("user").updateOne(getVendorFilter(vendorId), {
        $set: {
          stripeCustomerId: customerId,
          updatedAt: new Date(),
        },
      });
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
    const expiresAt = new Date(
      now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000,
    );

    const subscriptionData = {
      vendorId,
      plan: plan.id,
      status: "active",
      paymentStatus: "paid",
      paymentIntentId: paymentIntent.id,
      amount: plan.amount,
      currency: plan.currency,
      startedAt: now,
      expiresAt,
      cancelAtPeriodEnd: false,
      updatedAt: now,
      createdAt: now,
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
      message: "Subscription payment successful.",
      subscription: buildSubscriptionResponse(subscriptionData),
    });
  } catch (error) {
    console.error("Subscription payment error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Payment failed.",
    });
  }
});

// POST /verify-stripe-session
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

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (String(session.metadata?.vendorId) !== String(vendorId)) {
      return res.status(403).json({
        success: false,
        message: "This checkout session does not belong to you.",
      });
    }

    if (session.payment_status !== "paid") {
      return res.status(400).json({
        success: false,
        message: "Payment has not been completed.",
      });
    }

    const planId = session.metadata?.planId;

    if (!planId || !PREMIUM_PLANS.includes(planId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription plan in checkout session.",
      });
    }

    const db = getDB();

    const existingPayment = await db
      .collection("subscriptionPayments")
      .findOne({ stripeSessionId: session.id });

    if (existingPayment?.status === "paid") {
      const existingSubscription = await getSubscription(db, vendorId);

      return res.status(200).json({
        success: true,
        message: "Payment was already verified.",
        subscription: buildSubscriptionResponse(existingSubscription),
      });
    }

    const plan = getPlan(planId);
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
      stripePaymentIntentId: session.payment_intent,
      amount: session.amount_total / 100,
      currency: session.currency,
      startedAt: now,
      expiresAt,
      cancelAtPeriodEnd: false,
      createdAt: now,
      updatedAt: now,
    };

    await db.collection("subscriptions").insertOne(subscriptionData);

    await db.collection("subscriptionPayments").updateOne(
      { stripeSessionId: session.id },
      {
        $set: {
          status: "paid",
          paymentIntentId: session.payment_intent,
          updatedAt: now,
        },
        $setOnInsert: {
          vendorId,
          plan: plan.id,
          amount: session.amount_total / 100,
          currency: session.currency,
          createdAt: now,
        },
      },
      { upsert: true },
    );

    return res.status(200).json({
      success: true,
      message: "Subscription activated successfully.",
      subscription: buildSubscriptionResponse(subscriptionData),
    });
  } catch (error) {
    console.error("Verify Stripe session error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to verify Stripe payment.",
    });
  }
});

export default router;
