/**
 * Authentication & authorization middleware for WedPlan.
 *
 * authenticateUser:
 *  - Preferred: Better Auth session cookie (verified server-side, fresh DB user).
 *  - Also accepts a Bearer JWT issued by the Better Auth JWT plugin
 *    (verified with JWKS: signature, expiration, issuer and audience).
 *  - The current role is always read from the DATABASE, never from the request body,
 *    so stale tokens/roles cannot grant privileges.
 *
 * requireCustomer / requireVendor / requireAdmin:
 *  - Role gate built on top of authenticateUser.
 *  - Vendors must additionally be approved by an admin (vendorApproved === true).
 */
const { fromNodeHeaders } = require("better-auth/node");
const { createRemoteJWKSet, jwtVerify } = require("jose");

const { getAuth } = require("./auth");
const { getDB } = require("../config/db");
const { sanitizeUser, toId } = require("../utils/helpers");

let jwks = null;

/** Lazily creates the JWKS verifier pointed at this server's own JWKS endpoint. */
const getJWKSet = () => {
  if (!jwks) {
    const jwksURL = new URL("/api/auth/jwks", process.env.BETTER_AUTH_URL);
    jwks = createRemoteJWKSet(jwksURL);
  }
  return jwks;
};

/** Verifies a Bearer JWT: signature, expiration, issuer and audience are all checked. */
const verifyBearerToken = async (token) => {
  const baseURL = process.env.BETTER_AUTH_URL;

  const { payload } = await jwtVerify(token, getJWKSet(), {
    issuer: baseURL,
    audience: baseURL,
  });

  return payload;
};

/**
 * Authenticates the request.
 * Attaches the fresh DB user record to req.user on success, otherwise 401.
 *
 * Always ensures req.user has a normalised string `id` field regardless of
 * whether the user came from a session cookie (Better Auth) or a JWT.
 */
const authenticateUser = async (req, res, next) => {
  try {
    const auth = getAuth();

    let user = null;

    const authHeader = req.headers.authorization || "";

    if (authHeader.startsWith("Bearer ")) {
      // JWT API-token path
      const token = authHeader.slice(7).trim();

      let payload;
      try {
        payload = await verifyBearerToken(token);
      } catch {
        return res.status(401).json({
          success: false,
          message: "Invalid or expired token.",
        });
      }

      // Load the CURRENT user record from the database (fresh role & approval state)
      const db = getDB();
      const dbUser = await db
        .collection("user")
        .findOne({ _id: toId(payload.sub) });

      if (dbUser) {
        // Normalise: always expose a string `id` field
        const id =
          dbUser.id ??
          (dbUser._id
            ? typeof dbUser._id.toHexString === "function"
              ? dbUser._id.toHexString()
              : String(dbUser._id)
            : payload.sub);
        user = { ...dbUser, id };
      }
    } else {
      // Session cookie path (preferred for same-origin requests)
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });

      if (session?.user) {
        // Better Auth session user already has an `id` string.
        // If role is missing (e.g., older Better Auth version), default to "customer".
        const rawUser = session.user;
        user = {
          ...rawUser,
          id: rawUser.id ?? rawUser._id ?? "",
          role: rawUser.role ?? "customer",
        };
      }
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized. Please log in first.",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

/** Builds a role-check middleware. Never trusts role data from the request. */
const requireRole =
  (...roles) =>
  (req, res, next) => {
    const userRole = req.user?.role ?? "customer";

    if (!roles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. This action requires the ${roles.join(" or ")} role.`,
      });
    }

    next();
  };

/** Vendors must be approved by an admin before they can act as vendors. */
const requireVendorApproved = (req, res, next) => {
  if (req.user?.vendorApproved !== true) {
    return res.status(403).json({
      success: false,
      message:
        "Your vendor account has not been approved by an admin yet. Please wait for approval.",
    });
  }
  next();
};

/** Authenticated user of any role. */
const requireAuth = [authenticateUser];

/** Customer-only routes. Admins and vendors cannot create customer bookings. */
const requireCustomer = [authenticateUser, requireRole("customer")];

/** Vendor-only routes (must be approved by an admin). */
const requireVendor = [
  authenticateUser,
  requireRole("vendor"),
  requireVendorApproved,
];

/** Admin-only routes. */
const requireAdmin = [authenticateUser, requireRole("admin")];

module.exports = {
  authenticateUser,
  requireRole,
  requireVendorApproved,
  requireAuth,
  requireCustomer,
  requireVendor,
  requireAdmin,
  sanitizeUser,
};
