/**
 * Shared subscription utilities.
 * Premium is active only when the plan is valid,
 * status is active, payment is paid, and expiry is in the future.
 */

export const PREMIUM_PLANS = ["premium_monthly", "premium_yearly"];

export const isPremiumActive = (subscription) => {
  if (!subscription || typeof subscription !== "object") {
    return false;
  }

  if (!PREMIUM_PLANS.includes(subscription.plan)) {
    return false;
  }

  if (subscription.status !== "active") {
    return false;
  }

  if (subscription.paymentStatus !== "paid") {
    return false;
  }

  if (!subscription.expiresAt) {
    return false;
  }

  const expiresAt = new Date(subscription.expiresAt);

  if (Number.isNaN(expiresAt.getTime())) {
    return false;
  }

  return expiresAt.getTime() > Date.now();
};
