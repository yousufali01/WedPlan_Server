// ───────────────────────────────────────────────────────────────────────
// wedplan-server/src/config/db.js
// ───────────────────────────────────────────────────────────────────────
const { MongoClient, ServerApiVersion } = require("mongodb");

let client = null;
let db = null;
let connectionPromise = null;

/**
 * Builds the MongoDB Atlas URI using environment variables.
 */
const buildUri = () => {
  const dbUser = process.env.DB_USER;
  const dbPassword = process.env.DB_PASSWORD;
  const dbUri = process.env.DB_URI;

  const missing = [];
  if (!dbUri) missing.push("DB_URI");
  if (!dbUser) missing.push("DB_USER");
  if (!dbPassword) missing.push("DB_PASSWORD");

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  // Guard against placeholder values accidentally left in .env
  for (const [name, value] of [
    ["DB_USER", dbUser],
    ["DB_PASSWORD", dbPassword],
  ]) {
    if (value.includes("<")) {
      throw new Error(`${name} still contains a placeholder value.`);
    }
  }

  let uri = dbUri;

  // If the URI contains the Atlas placeholders, replace them
  if (uri.includes("<db_username>") || uri.includes("<db_password>")) {
    uri = uri
      .replace("<db_username>", encodeURIComponent(dbUser))
      .replace("<db_password>", encodeURIComponent(dbPassword));
  } else if (!uri.includes("@")) {
    // No credentials embedded – prepend them
    const scheme = uri.startsWith("mongodb://") ? "mongodb://" : "mongodb+srv://";
    const rest = uri.startsWith(scheme) ? uri.slice(scheme.length) : uri;
    uri = `${scheme}${encodeURIComponent(dbUser)}:${encodeURIComponent(dbPassword)}@${rest}`;
  }

  return uri;
};

/**
 * Re‑uses a single MongoDB connection for the whole serverless instance.
 */
const connectDB = async () => {
  // Return early if we already have a live connection
  if (db && client) {
    return db;
  }

  // Avoid parallel connection attempts
  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = (async () => {
    const uri = buildUri();

    const newClient = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
      serverSelectionTimeoutMS: 10_000,
      connectTimeoutMS: 10_000,
      maxPoolSize: 10,
    });

    try {
      await newClient.connect();

      const database = newClient.db(process.env.DB_NAME || "WedPlan");
      // Real connectivity test – ping the server
      await database.command({ ping: 1 });

      client = newClient;
      db = database;

      console.log("MongoDB Connected Successfully!");
      return db;
    } catch (error) {
      console.error("MongoDB Connection Failed:", error.message);
      // Clean up a half‑created client so a retry can start fresh
      await newClient.close().catch(() => {});
      client = null;
      db = null;
      throw error;
    }
  })();

  // Ensure we clear the promise flag after it settles
  try {
    return await connectionPromise;
  } finally {
    connectionPromise = null;
  }
};

/** Returns the connected database (throws if not initialised). */
const getDB = () => {
  if (!db) {
    throw new Error("Database is not connected. Call connectDB() first.");
  }
  return db;
};

/** Returns the underlying MongoClient (used by Better‑Auth). */
const getClient = () => {
  if (!client) {
    throw new Error("MongoDB client is not initialized.");
  }
  return client;
};

/** Graceful shutdown (used only when running locally). */
const closeDB = async () => {
  if (client) {
    const currentClient = client;
    client = null;
    db = null;
    connectionPromise = null;
    await currentClient.close();
    console.log("MongoDB connection closed.");
  }
};

module.exports = {
  connectDB,
  getDB,
  getClient,
  closeDB,
  buildUri,
};
