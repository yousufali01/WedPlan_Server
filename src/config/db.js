
import { MongoClient, ServerApiVersion } from "mongodb";

let client = null;
let db = null;
let connectionPromise = null;

// ─────────────────────────────────────────────
// BUILD MONGODB URI
// ─────────────────────────────────────────────

const buildUri = () => {
  const dbUri = process.env.DB_URI;
  const dbUser = process.env.DB_USER;
  const dbPassword = process.env.DB_PASSWORD;

  if (!dbUri) {
    throw new Error("Missing required environment variable: DB_URI");
  }

  const hasCredentials = dbUri.includes("@");

  let uri = dbUri;

  // Replace Atlas placeholders
  if (uri.includes("<db_username>") || uri.includes("<db_password>")) {
    if (!dbUser || !dbPassword) {
      throw new Error(
        "DB_USER and DB_PASSWORD are required for Atlas URI placeholders.",
      );
    }

    uri = uri
      .replace("<db_username>", encodeURIComponent(dbUser))
      .replace("<db_password>", encodeURIComponent(dbPassword));
  }

  // Add credentials if not already included
  else if (!hasCredentials) {
    if (!dbUser || !dbPassword) {
      throw new Error(
        "DB_USER and DB_PASSWORD are required when DB_URI has no credentials.",
      );
    }

    const scheme = uri.startsWith("mongodb://")
      ? "mongodb://"
      : uri.startsWith("mongodb+srv://")
        ? "mongodb+srv://"
        : null;

    if (!scheme) {
      throw new Error(
        "DB_URI must start with mongodb:// or mongodb+srv://",
      );
    }

    const rest = uri.slice(scheme.length);

    uri =
      scheme +
      `${encodeURIComponent(dbUser)}:${encodeURIComponent(dbPassword)}@` +
      rest;
  }

  // Validate URI
  if (
    !uri.startsWith("mongodb://") &&
    !uri.startsWith("mongodb+srv://")
  ) {
    throw new Error("Invalid MongoDB connection URI.");
  }

  if (uri.includes("<")) {
    throw new Error(
      "MongoDB URI still contains unresolved placeholder values.",
    );
  }

  return uri;
};

// ─────────────────────────────────────────────
// CREATE DATABASE INDEXES
// ─────────────────────────────────────────────

const createDatabaseIndexes = async (database) => {
  // Subscription unique Stripe session index
  await database.collection("subscriptions").createIndex(
    { stripeSessionId: 1 },
    {
      name: "unique_stripe_subscription_session",
      unique: true,
      partialFilterExpression: {
        stripeSessionId: { $type: "string" },
      },
    },
  );

  // Payment unique Stripe session index
  await database.collection("subscriptionPayments").createIndex(
    { stripeSessionId: 1 },
    {
      name: "unique_stripe_payment_session",
      unique: true,
      partialFilterExpression: {
        stripeSessionId: { $type: "string" },
      },
    },
  );

  console.log("Subscription indexes created successfully.");
};

// ─────────────────────────────────────────────
// CONNECT DATABASE
// ─────────────────────────────────────────────

const connectDB = async () => {
  if (db && client) {
    return db;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = (async () => {
    let newClient;

    try {
      const uri = buildUri();

      newClient = new MongoClient(uri, {
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

      await newClient.connect();

      const database = newClient.db(
        process.env.DB_NAME || "WedPlan",
      );

      await database.command({ ping: 1 });

      // Assign connected database
      client = newClient;
      db = database;

      console.log(
        `MongoDB Connected Successfully: ${database.databaseName}`,
      );

      // Create indexes only after successful connection
      await createDatabaseIndexes(database);

      return db;
    } catch (error) {
      console.error(
        "MongoDB Connection Failed:",
        error.message,
      );

      if (newClient) {
        await newClient.close().catch(() => {});
      }

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

// ─────────────────────────────────────────────
// GET DATABASE
// ─────────────────────────────────────────────

const getDB = () => {
  if (!db) {
    throw new Error(
      "Database is not connected. Call connectDB() first.",
    );
  }

  return db;
};

// ─────────────────────────────────────────────
// GET MONGODB CLIENT
// ─────────────────────────────────────────────

const getClient = () => {
  if (!client) {
    throw new Error("MongoDB client is not initialized.");
  }

  return client;
};

// ─────────────────────────────────────────────
// CLOSE DATABASE
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

export {
  connectDB,
  getDB,
  getClient,
  closeDB,
  buildUri,
};
