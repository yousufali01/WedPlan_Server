import "dotenv/config";

import { connectDB, closeDB } from "../src/config/db.js";
import { initAuth } from "../src/(auth)/auth.js";
import { isNonEmptyString } from "../src/utils/helpers.js";

const createAdmin = async () => {
  let exitCode = 0;

  try {
    const name = process.env.ADMIN_NAME;
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;

    const missing = [];

    if (!isNonEmptyString(name, 2, 50)) {
      missing.push("ADMIN_NAME");
    }

    if (!isNonEmptyString(email, 5, 100) || !email.includes("@")) {
      missing.push("ADMIN_EMAIL (must be a valid email)");
    }

    if (!isNonEmptyString(password, 8)) {
      missing.push("ADMIN_PASSWORD (min 8 chars)");
    }

    if (missing.length > 0) {
      throw new Error(
        `Missing/invalid environment variable(s): ${missing.join(", ")}. ` +
          "Set ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD in .env first.",
      );
    }

    const db = await connectDB();
    const auth = initAuth(db, null);

    // Server-side creation through Better Auth
    await auth.api.createUser({
      body: {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        role: "admin",
      },
    });

    console.log(`✅ Admin created successfully: ${email.trim().toLowerCase()}`);

    console.log(
      "   You can now log in with this account through /api/auth/sign-in/email",
    );
  } catch (error) {
    const message = error?.message || String(error);
    const bodyMessage = error?.body?.message;

    if (
      message.includes("already exists") ||
      message.includes("USER_ALREADY_EXISTS") ||
      (bodyMessage && bodyMessage.toLowerCase().includes("already"))
    ) {
      console.log(
        "ℹ️  An account with this email already exists. No changes were made.",
      );

      console.log(
        "   If it is not an admin yet, promote it with the admin role API by another admin.",
      );
    } else {
      console.error("❌ Admin creation failed:", message);
      exitCode = 1;
    }
  } finally {
    await closeDB();
  }

  process.exit(exitCode);
};

createAdmin();
