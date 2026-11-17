require("dotenv").config();

const express = require("express");
const cors = require("cors");

const { connectDB, getDB, closeDB } = require("./config/db");

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Root API
app.get("/", (req, res) => {
  res.send("Welcome to WedPlan Server!");
});

// Server Health
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "WedPlan Server is Running!",
  });
});

// MongoDB Test
app.get("/test-db", async (req, res) => {
  try {
    const db = getDB();

    await db.command({ ping: 1 });

    res.status(200).json({
      success: true,
      message: "MongoDB Connected Successfully!",
      database: db.databaseName,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Start Server
const startServer = async () => {
  try {
    await connectDB();

    app.listen(PORT, () => {
      console.log(`WedPlan Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("❌ Server Startup Failed:", error.message);
    process.exit(1);
  }
};

// Graceful Shutdown
process.on("SIGINT", async () => {
  await closeDB();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closeDB();
  process.exit(0);
});

startServer();
