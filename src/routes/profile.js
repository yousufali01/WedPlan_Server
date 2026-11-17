/**
 * Profile routes (authenticated users).
 * Clients can only change name/image - role, vendorApproved and email
 * are never accepted from the request body (no mass assignment).
 */
const express = require("express");
const { fromNodeHeaders } = require("better-auth/node");

const { getAuth } = require("../lib/auth");
const { requireAuth } = require("../middleware/auth");
const { sanitizeUser, isNonEmptyString } = require("../utils/helpers");

const router = express.Router();

/** GET /api/v1/profile - current authenticated user */
router.get("/", requireAuth, (req, res) => {
  res.status(200).json({
    success: true,
    user: sanitizeUser(req.user),
  });
});

/** PATCH /api/v1/profile - update own profile (name and image only) */
router.patch("/", requireAuth, async (req, res, next) => {
  try {
    const updates = {};

    if (req.body.name !== undefined) {
      if (!isNonEmptyString(req.body.name, 2, 50)) {
        return res.status(400).json({
          success: false,
          message: "Name must be a string between 2 and 50 characters.",
        });
      }
      updates.name = req.body.name.trim();
    }

    if (req.body.image !== undefined) {
      if (req.body.image !== null && !isNonEmptyString(req.body.image, 1, 500)) {
        return res.status(400).json({
          success: false,
          message: "Image must be a URL string (or null to remove it).",
        });
      }
      updates.image = req.body.image;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Nothing to update. Send 'name' and/or 'image'.",
      });
    }

    const auth = getAuth();
    await auth.api.updateUser({
      headers: fromNodeHeaders(req.headers),
      body: updates,
    });

    // Re-fetch the fresh user record
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      user: sanitizeUser(session.user),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
