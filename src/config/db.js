const { MongoClient, ServerApiVersion } = require("mongodb");

let client = null;
let db = null;
let connectionPromise = null;

/**
 * Builds MongoDB Atlas URI using environment variables.
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
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }

  for (const [name, value] of [
    ["DB_USER", dbUser],
    ["DB_PASSWORD", dbPassword],
  ]) {
    if (value.includes("<")) {
      throw new Error(`${name} still contains a placeholder value.`);
    }
  }

  let uri = dbUri;

  if (uri.includes("<db_username>") || uri.includes("<db_password>")) {
    uri = uri
      .replace("<db_username>", encodeURIComponent(dbUser))
      .replace("<db_password>", encodeURIComponent(dbPassword));
  } else if (!uri.includes("@")) {
    const scheme = uri.startsWith("mongodb://")
      ? "mongodb://"
      : "mongodb+srv://";

    const rest = uri.startsWith(scheme) ? uri.slice(scheme.length) : uri;

    uri = `${scheme}${encodeURIComponent(dbUser)}:${encodeURIComponent(
      dbPassword,
    )}@${rest}`;
  }

  return uri;
};

/**
 * Reuses one MongoDB connection per serverless instance.
 */
const connectDB = async () => {
  if (db && client) {
    return db;
  }

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
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      maxPoolSize: 10,
      minPoolSize: 0,
    });

    try {
      await newClient.connect();

      const database = newClient.db(process.env.DB_NAME || "WedPlan");

      await database.command({ ping: 1 });

      client = newClient;
      db = database;

      console.log("MongoDB Connected Successfully!");

      return db;
    } catch (error) {
      console.error("MongoDB Connection Failed:", error.message);

      await newClient.close().catch(() => {});

      client = null;
      db = null;

      throw error;
    }
  })();

  try {
    return await connectionPromise;
  } finally {
    connectionPromise = null;
  }
};

/**
 * Returns the connected database.
 */
const getDB = () => {
  if (!db) {
    throw new Error("Database is not connected. Call connectDB() first.");
  }

  return db;
};

/**
 * Returns the existing MongoDB client.
 */
const getClient = () => {
  if (!client) {
    throw new Error("MongoDB client is not initialized.");
  }

  return client;
};

/**
 * Graceful shutdown for local development.
 */
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
