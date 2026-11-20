// ───────────────────────────────────────────────────────────────────────
// wedplan-server/index.js
// ───────────────────────────────────────────────────────────────────────
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { toNodeHandler } = require("better-auth/node");

const { connectDB, getDB, getClient } = require("./src/config/db");
const { ensureIndexes } = require("./src/config/indexes");
const { initAuth, getAuth } = require("./src/(auth)/auth");

const app = express();
const PORT = process.env.PORT || 5000;

// ───────────────────────────────────────────────────────────────────────
// CORS configuration – include the Vercel client URL
// ───────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  process.env.FRONTEND_URL,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  // optional: Vercel client URL (keeps the whitelist explicit)
  process.env.VERCEL_CLIENT_URL || "https://wedplan-client-rho.vercel.app",
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ───────────────────────────────────────────────────────────────────────
// Simple, unauthenticated routes (always available)
// ───────────────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.status(200).send("Welcome to WedPlan Server!");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "WedPlan Server is Running!",
  });
});

// ───────────────────────────────────────────────────────────────────────
// Server/DB initialisation – runs only once per Vercel instance
// ───────────────────────────────────────────────────────────────────────
let initializationPromise = null;
let initialized = false;

const initializeApp = async () => {
  if (initialized) return;

  if (!initializationPromise) {
    initializationPromise = (async () => {
      console.log("Initializing WedPlan Server...");

      // 1️⃣ Connect to MongoDB
      const db = await connectDB();

      // 2️⃣ Initialise Better-Auth (uses the shared MongoDB client)
      initAuth(db, getClient());

      // 3️⃣ Ensure our DB indexes exist
      await ensureIndexes(db);

      initialized = true;
      console.log("WedPlan Server initialized successfully.");
    })().catch((error) => {
      console.error("WedPlan Initialization Failed:", error);
      initialized = false;
      initializationPromise = null; // allow a retry on next request
      throw error;
    });
  }

  return initializationPromise;
};

// Middleware that guarantees the above has completed before any API route runs
app.use(async (req, res, next) => {
  try {
    await initializeApp();
    next();
  } catch (error) {
    console.error("Request Initialization Error:", error.message);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Server initialization failed.",
      });
    }
  }
});

// ───────────────────────────────────────────────────────────────────────
// Better-Auth handler – must stay **before** `express.json()`
// ───────────────────────────────────────────────────────────────────────
app.all("/api/auth/{*splat}", (req, res, next) => {
  try {
    const authHandler = toNodeHandler(getAuth());
    return authHandler(req, res, next);
  } catch (error) {
    return next(error);
  }
});

// ───────────────────────────────────────────────────────────────────────
// Body parser (JSON)
// ───────────────────────────────────────────────────────────────────────
app.use(express.json());

// ───────────────────────────────────────────────────────────────────────
// Simple DB health check (useful while debugging)
// ───────────────────────────────────────────────────────────────────────
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

// ───────────────────────────────────────────────────────────────────────
// API routes (protected by the init‑middleware above)
// ───────────────────────────────────────────────────────────────────────
app.use("/api/v1/profile", require("./src/(customer)/profile"));
app.use("/api/v1/services", require("./src/(public)/services"));
app.use("/services", require("./src/(public)/services"));
app.use("/api/v1/bookings", require("./src/(customer)/bookings"));
app.use("/api/v1/admin", require("./src/(admin)/admin"));
app.use("/api/v1/planner", require("./src/(customer)/planner"));
app.use("/api/v1/subscription", require("./src/(vendor)/subscription"));

// ───────────────────────────────────────────────────────────────────────
// 404 handler
// ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// ───────────────────────────────────────────────────────────────────────
// Central error handler (no stack leaks)
// ───────────────────────────────────────────────────────────────────────
app.use((error, req, res, next) => {
  console.error("WedPlan API Error:", error);
  if (res.headersSent) return next(error);

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

// ───────────────────────────────────────────────────────────────────────
// Local dev server (Vercel ignores this, but it’s handy for `npm run dev`)
// ───────────────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`WedPlan Server running on port ${PORT}`);
  });

  const shutdown = async () => {
    console.log("Shutting down WedPlan Server...");
    const { closeDB } = require("./src/config/db");
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

// Vercel expects the exported Express instance
module.exports = app;
