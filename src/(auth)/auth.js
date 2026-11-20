
/**
 * Better Auth configuration for WedPlan.
 *
 * Reuses the existing MongoDB connection created in src/config/db.js.
 * No new MongoClient is created here.
 *
 * Roles: customer (default) | vendor | admin
 *
 * - New users are always "customer".
 * - Frontend cannot assign privileged roles.
 * - Vendor/admin roles are granted only through protected admin APIs
 *   or the protected create-admin script.
 * - vendorApproved is controlled by admins.
 */

const { betterAuth } = require("better-auth");
const { mongodbAdapter } = require("@better-auth/mongo-adapter");
const { admin, jwt } = require("better-auth/plugins");

const ROLES = ["customer", "vendor", "admin"];

// ───────────────────────────────────────────────────────────────────────
// Environment Validation
// ───────────────────────────────────────────────────────────────────────

const validateEnv = () => {
  const missing = [];

  if (!process.env.BETTER_AUTH_SECRET) {
    missing.push("BETTER_AUTH_SECRET");
  }

  if (!process.env.BETTER_AUTH_URL) {
    missing.push("BETTER_AUTH_URL");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        "Please configure them in your environment variables."
    );
  }

  if (
    process.env.BETTER_AUTH_SECRET ===
    process.env.GOOGLE_CLIENT_SECRET
  ) {
    throw new Error(
      "BETTER_AUTH_SECRET must NOT be the same as GOOGLE_CLIENT_SECRET."
    );
  }
};

// ───────────────────────────────────────────────────────────────────────
// Auth Instance
// ───────────────────────────────────────────────────────────────────────

let auth = null;

/**
 * Creates the Better Auth instance using the existing MongoDB connection.
 *
 * @param {import("mongodb").Db} db
 * @param {import("mongodb").MongoClient} client
 */

const initAuth = (db, client) => {
  if (auth) return auth;

  if (!db || !client) {
    throw new Error(
      "MongoDB database or client is missing during Better Auth initialization."
    );
  }

  validateEnv();

  auth = betterAuth({
    // ─────────────────────────────────────────────────────────────────
    // MongoDB Adapter - Shared Existing Connection
    // ─────────────────────────────────────────────────────────────────

    database: mongodbAdapter(db, {
      client,
      transaction: true,
    }),

    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,

    // ─────────────────────────────────────────────────────────────────
    // Trusted Origins
    // ─────────────────────────────────────────────────────────────────

    trustedOrigins: [
      process.env.FRONTEND_URL,
      process.env.VERCEL_CLIENT_URL,
      "https://wedplan-client-rho.vercel.app",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ].filter(Boolean),

    // ─────────────────────────────────────────────────────────────────
    // Email & Password Authentication
    // ─────────────────────────────────────────────────────────────────

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
    },

    // ─────────────────────────────────────────────────────────────────
    // Session Configuration
    // ─────────────────────────────────────────────────────────────────

    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },

    // ─────────────────────────────────────────────────────────────────
    // Additional User Fields
    // ─────────────────────────────────────────────────────────────────

    user: {
      additionalFields: {
        vendorApproved: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
        },

        businessName: {
          type: "string",
          required: false,
          input: false,
        },

        studioName: {
          type: "string",
          required: false,
          input: false,
        },

        phone: {
          type: "string",
          required: false,
          input: false,
        },

        location: {
          type: "string",
          required: false,
          input: false,
        },

        bio: {
          type: "string",
          required: false,
          input: false,
        },

        website: {
          type: "string",
          required: false,
          input: false,
        },
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // Google Authentication
    // ─────────────────────────────────────────────────────────────────

    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      },
    },

    // ─────────────────────────────────────────────────────────────────
    // Plugins
    // ─────────────────────────────────────────────────────────────────

    plugins: [
      admin({
        defaultRole: "customer",
        adminRoles: ["admin"],
      }),

      jwt(),
    ],
  });

  return auth;
};

// ───────────────────────────────────────────────────────────────────────
// Get Auth Instance
// ───────────────────────────────────────────────────────────────────────

const getAuth = () => {
  if (!auth) {
    throw new Error(
      "Better Auth is not initialized! Make sure initAuth(db, client) runs after connectDB()."
    );
  }

  return auth;
};

// ───────────────────────────────────────────────────────────────────────
// Exports
// ───────────────────────────────────────────────────────────────────────

module.exports = {
  initAuth,
  getAuth,
  ROLES,
};
