/**
 * Ensures required application-level MongoDB indexes exist.
 *
 * Better Auth manages its own collections.
 * These indexes support services, bookings and session expiration.
 */

const ensureIndexes = async (db) => {
  const created = [];

  // Services indexes
  await db.collection("services").createIndex({
    vendorId: 1,
  });
  created.push("services.vendorId");

  await db.collection("services").createIndex({
    category: 1,
  });
  created.push("services.category");

  // Bookings indexes
  await db.collection("bookings").createIndex({
    customerId: 1,
  });
  created.push("bookings.customerId");

  await db.collection("bookings").createIndex({
    vendorId: 1,
  });
  created.push("bookings.vendorId");

  await db.collection("bookings").createIndex({
    serviceId: 1,
  });
  created.push("bookings.serviceId");

  await db.collection("bookings").createIndex({
    status: 1,
  });
  created.push("bookings.status");

  // Better Auth session TTL index
  await db
    .collection("session")
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  created.push("session.expiresAt (TTL)");

  console.log(`Database indexes ready: ${created.join(", ")}`);
};

export { ensureIndexes };
