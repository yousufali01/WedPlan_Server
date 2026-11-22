/**
 * Regression check for the "rejected vendor reappears in pending" bug.
 * Run against a server instance, e.g.:
 *   PORT=5001 node index.js         (terminal 1)
 *   BASE_URL=http://localhost:5001 node scripts/verify-vendor-approval.js
 *
 * Creates one throwaway test vendor and deletes it at the end.
 */
import "dotenv/config";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

let passed = 0;
let failed = 0;

const check = (name, condition, detail = "") => {
  if (condition) {
    passed++;
    console.log(`  PASS: ${name}`);
  } else {
    failed++;
    console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const createClient = () => {
  let cookieJar = [];

  return {
    async request(method, path, { body } = {}) {
      const headers = {};

      // Only send an Origin when explicitly allowed by the server's CORS list.
      if (process.env.TEST_ORIGIN) headers.Origin = process.env.TEST_ORIGIN;

      if (cookieJar.length) headers.Cookie = cookieJar.join("; ");
      if (body !== undefined) headers["Content-Type"] = "application/json";

      const res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: "manual",
      });

      for (const cookie of res.headers.getSetCookie?.() ?? []) {
        const [pair] = cookie.split(";");
        const [name] = pair.split("=");
        cookieJar = cookieJar.filter((c) => !c.startsWith(`${name}=`));
        cookieJar.push(pair);
      }

      let json = null;
      try {
        json = await res.json();
      } catch {
        // non-JSON
      }

      return { status: res.status, json };
    },
  };
};

const run = async () => {
  console.log(`\nVerifying vendor approval flow against ${BASE}\n`);

  const admin = createClient();
  const vendor = createClient();

  const login = await admin.request("POST", "/api/auth/sign-in/email", {
    body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD },
  });
  check("admin login", login.status === 200, `status ${login.status}`);
  if (login.status !== 200) return;

  const email = `review-test-${Date.now()}@wedplan-test.dev`;
  const signup = await vendor.request("POST", "/api/auth/sign-up/email", {
    body: { email, password: "SuperSecret123", name: "Review Test Vendor" },
  });
  check("test vendor created", signup.status === 200, `status ${signup.status}`);

  const vendorId = signup.json?.user?.id;
  if (!vendorId) return;

  try {
    const promote = await admin.request(
      "PATCH",
      `/api/v1/admin/users/${vendorId}/role`,
      { body: { role: "vendor" } },
    );
    check("promoted to vendor", promote.status === 200, `status ${promote.status}`);

    const before = await admin.request("GET", "/api/v1/admin/vendors/pending");
    check(
      "vendor appears in pending queue",
      before.json?.vendors?.some((v) => v.id === vendorId),
    );

    const reject = await admin.request(
      "PATCH",
      `/api/v1/admin/vendors/${vendorId}/approval`,
      { body: { approved: false } },
    );
    check(
      "reject records 'rejected' review status",
      reject.status === 200 && reject.json?.vendor?.vendorReviewStatus === "rejected",
      JSON.stringify(reject.json?.vendor),
    );

    const after = await admin.request("GET", "/api/v1/admin/vendors/pending");
    check(
      "rejected vendor is gone from pending queue",
      after.json?.vendors?.every((v) => v.id !== vendorId),
      JSON.stringify(after.json?.vendors?.map((v) => v.id)),
    );

    const again = await admin.request("GET", "/api/v1/admin/vendors/pending");
    check(
      "rejected vendor stays gone on re-fetch",
      again.json?.vendors?.every((v) => v.id !== vendorId),
    );

    const reapply = await vendor.request("POST", "/api/v1/profile/apply-vendor", {
      body: {},
    });
    check("vendor can re-apply", reapply.status === 200, `status ${reapply.status}`);

    const reapplied = await admin.request("GET", "/api/v1/admin/vendors/pending");
    check(
      "re-applied vendor returns to pending queue",
      reapplied.json?.vendors?.some((v) => v.id === vendorId),
    );
  } finally {
    const cleanup = await admin.request("DELETE", `/api/v1/admin/users/${vendorId}`);
    check("test vendor deleted", cleanup.status === 200, `status ${cleanup.status}`);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
