/**
 * Planner routes — the signed-in user's Wedding Budget and Checklist.
 *
 * Data is stored in MongoDB (one document per user).
 * The frontend keeps a localStorage copy only as an offline fallback.
 */

import express from "express";

import { getDB } from "../config/db.js";
import { requireAuth } from "../(auth)/middleware.js";

const router = express.Router();

const DEFAULT_TOTAL_BUDGET = 500000;
const MAX_ITEMS = 200;
const MAX_CHECKLIST_KEYS = 500;
const MAX_ID_LENGTH = 64;

const userIdOf = (req) => String(req.user?.id ?? req.user?._id ?? "");

const asNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clampMoney = (value, fallback) => {
  const n = asNumber(value, fallback);

  if (n < 0) return 0;

  // Guards against absurd values blowing up the UI.
  return Math.min(n, 1_000_000_000_000);
};

/** Validates and normalises the budget payload from the client. */
const sanitizeBudget = (body) => {
  const source = body && typeof body === "object" ? body : {};

  const items = Array.isArray(source.items) ? source.items : [];
  const cleanItems = [];

  for (const raw of items.slice(0, MAX_ITEMS)) {
    if (!raw || typeof raw !== "object") continue;

    const category =
      typeof raw.category === "string" && raw.category.trim()
        ? raw.category.trim().slice(0, 80)
        : "Miscellaneous";

    cleanItems.push({
      id:
        typeof raw.id === "string" && raw.id.trim()
          ? raw.id.trim().slice(0, MAX_ID_LENGTH)
          : `item-${cleanItems.length}-${Date.now()}`,
      category,
      estimated: clampMoney(raw.estimated, 0),
      actual: clampMoney(raw.actual, 0),
    });
  }

  return {
    totalBudget: clampMoney(source.totalBudget, DEFAULT_TOTAL_BUDGET),
    items: cleanItems,
  };
};

/** Validates and normalises the checklist done-map from the client. */
const sanitizeChecklist = (body) => {
  const source = body && typeof body === "object" ? body : {};
  const done = {};
  let count = 0;

  for (const [key, value] of Object.entries(source)) {
    if (count >= MAX_CHECKLIST_KEYS) break;

    if (typeof key !== "string" || !key.trim() || key.length > MAX_ID_LENGTH) {
      continue;
    }

    // Only boolean values are stored.
    if (value === true || value === false) {
      done[key] = value;
      count++;
    }
  }

  return done;
};

const loadDoc = async (req) => {
  const db = getDB();

  return db.collection("planner").findOne({ _id: userIdOf(req) });
};

/** GET /api/v1/planner */
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const doc = await loadDoc(req);

    res.status(200).json({
      success: true,
      budget: doc?.budget || {
        totalBudget: DEFAULT_TOTAL_BUDGET,
        items: [],
      },
      checklist: doc?.checklist || {},
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/v1/planner/budget */
router.get("/budget", requireAuth, async (req, res, next) => {
  try {
    const doc = await loadDoc(req);

    res.status(200).json({
      success: true,
      budget: doc?.budget || {
        totalBudget: DEFAULT_TOTAL_BUDGET,
        items: [],
      },
    });
  } catch (error) {
    next(error);
  }
});

/** GET /api/v1/planner/checklist */
router.get("/checklist", requireAuth, async (req, res, next) => {
  try {
    const doc = await loadDoc(req);

    res.status(200).json({
      success: true,
      checklist: doc?.checklist || {},
    });
  } catch (error) {
    next(error);
  }
});

/** PUT /api/v1/planner/budget */
router.put("/budget", requireAuth, async (req, res, next) => {
  try {
    const budget = sanitizeBudget(req.body);
    const db = getDB();

    await db.collection("planner").updateOne(
      { _id: userIdOf(req) },
      {
        $set: {
          budget,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );

    res.status(200).json({
      success: true,
      message: "Budget saved.",
      budget,
    });
  } catch (error) {
    next(error);
  }
});

/** PUT /api/v1/planner/checklist */
router.put("/checklist", requireAuth, async (req, res, next) => {
  try {
    const checklist = sanitizeChecklist(req.body);
    const db = getDB();

    await db.collection("planner").updateOne(
      { _id: userIdOf(req) },
      {
        $set: {
          checklist,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );

    res.status(200).json({
      success: true,
      message: "Checklist saved.",
      checklist,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
