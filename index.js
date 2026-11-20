require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { toNodeHandler } = require("better-auth/node");

const { connectDB, getDB, getClient, closeDB } = require("./src/config/db");

const { ensureIndexes } = require("./src/config/indexes");
const { initAuth, getAuth } = require("./src/(auth)/auth");

const app = express();
const PORT = process.env.PORT || 5000;

// ─────────────────────────────────────────────
// CORS CONFIGURATION
// ─────────────────────────────────────────────

const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.VERCEL_CLIENT_URL,
  "https://wedplan-client-rho.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.error("CORS blocked origin:", origin);

    return callback(new Error("Not allowed by CORS"));
  },

  credentials: true,

  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],

  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));

// ─────────────────────────────────────────────
// BASIC ROUTES
// ─────────────────────────────────────────────

app.get("/", (req, res) => {
  res.status(200).send("Welcome to WedPlan Server!");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "WedPlan Server is Running!",
  });
});

// ─────────────────────────────────────────────
// DATABASE & AUTH INITIALIZATION
// ─────────────────────────────────────────────

let initializationPromise = null;
let initialized = false;

const initializeApp = async () => {
  if (initialized) return;

  if (!initializationPromise) {
    initializationPromise = (async () => {
      console.log("Initializing WedPlan Server...");

      // 1. Connect MongoDB
      const db = await connectDB();

      // 2. Initialize Better Auth
      initAuth(db, getClient());

      // 3. Ensure database indexes
      await ensureIndexes(db);

      initialized = true;

      console.log("WedPlan Server initialized successfully.");
    })().catch((error) => {
      console.error("WedPlan Initialization Failed:", error);

      initialized = false;
      initializationPromise = null;

      throw error;
    });
  }

  return initializationPromise;
};

// ─────────────────────────────────────────────
// INITIALIZATION MIDDLEWARE
// ─────────────────────────────────────────────

app.use(async (req, res, next) => {
  try {
    await initializeApp();
    next();
  } catch (error) {
    console.error("Request Initialization Error:", error);

    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Server initialization failed.",
      });
    }
  }
});

// ─────────────────────────────────────────────
// BETTER AUTH HANDLER
// Must be before express.json()
// ─────────────────────────────────────────────

app.all("/api/auth/{*splat}", (req, res, next) => {
  try {
    const authHandler = toNodeHandler(getAuth());

    return authHandler(req, res, next);
  } catch (error) {
    return next(error);
  }
});

// ─────────────────────────────────────────────
// JSON BODY PARSER
// ─────────────────────────────────────────────

app.use(express.json());

// ─────────────────────────────────────────────
// DATABASE HEALTH CHECK
// ─────────────────────────────────────────────

app.get("/test-db", async (req, res, next) => {
  try {
    const database = getDB();

    await database.command({ ping: 1 });

    res.status(200).json({
      success: true,
      message: "MongoDB Connected Successfully!",
      database: database.databaseName,
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────

// Customer Profile
app.use("/api/v1/profile", require("./src/(customer)/profile"));

// Public Services
app.use("/api/v1/services", require("./src/(public)/services"));

app.use("/services", require("./src/(public)/services"));

// Customer Bookings
app.use("/api/v1/bookings", require("./src/(customer)/bookings"));

// Admin Routes
app.use("/api/v1/admin", require("./src/(admin)/admin"));

// Customer Planner
app.use("/api/v1/planner", require("./src/(customer)/planner"));

// Vendor Subscription
app.use("/api/v1/subscription", require("./src/(vendor)/subscription"));

// ─────────────────────────────────────────────
// 404 HANDLER
// ─────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// ─────────────────────────────────────────────
// CENTRAL ERROR HANDLER
// ─────────────────────────────────────────────

app.use((error, req, res, next) => {
  console.error("WedPlan API Error:", error);

  if (res.headersSent) {
    return next(error);
  }

  const status =
    typeof error?.status === "number"
      ? error.status
      : typeof error?.statusCode === "number"
        ? error.statusCode
        : 500;

  res.status(status).json({
    success: false,
    message: error.message || "Internal server error.",
  });
});

// ─────────────────────────────────────────────
// LOCAL SERVER
// ─────────────────────────────────────────────

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`WedPlan Server running on port ${PORT}`);
  });

  const shutdown = async () => {
    console.log("Shutting down WedPlan Server...");

    try {
      await closeDB();
      process.exit(0);
    } catch (error) {
      console.error("Shutdown Error:", error);
      process.exit(1);
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ─────────────────────────────────────────────
// VERCEL EXPORT
// ─────────────────────────────────────────────

module.exports = app;
