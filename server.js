
import express from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth.js";

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  })
);

// Better Auth handler
// Express 5:
app.all("/api/auth/*splat", toNodeHandler(auth));

// Other middleware
app.use(express.json());

// Your existing API routes
// app.use("/api/v1/services", serviceRoutes);
// app.use("/api/v1/bookings", bookingRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
