import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const fixtures = JSON.parse(readFileSync(process.env.E2E_FIXTURE_PATH!, "utf8"));

test("session tokens remain HTTP-only, proxy stays allowlisted, logout revokes session", async ({ request, baseURL }) => {
  const unauthorized = await request.get("/api/session");
  expect(unauthorized.status()).toBe(401);
  const loggedIn = await request.post("/api/session", {
    headers: { Origin: baseURL! }, data: { email: fixtures.email, password: fixtures.password },
  });
  expect(loggedIn.status()).toBe(200);
  const payload = await loggedIn.json();
  expect(payload.user.email).toBe(fixtures.email);
  expect(payload).not.toHaveProperty("accessToken");
  expect(loggedIn.headers()["set-cookie"]).toMatch(/httponly/i);
  expect(loggedIn.headers()["set-cookie"]).toMatch(/samesite=lax/i);
  const state = await request.storageState();
  expect(state.cookies.some(cookie => cookie.httpOnly)).toBe(true);

  const blocked = await request.get("/api/pos/users");
  expect(blocked.status()).toBe(404);
  const foreign = await request.post(`/api/pos/sales?businessLineId=${fixtures.kedai.id}`, {
    headers: { Origin: "https://attacker.example", "X-Idempotency-Key": "cross-origin-test" },
    data: { items: [{ itemId: fixtures.product.id, itemType: "product", quantity: 1 }], paymentMethod: "cash", cashReceived: 10000 },
  });
  expect(foreign.status()).toBe(403);
  const sessionCookie = state.cookies.find(cookie => cookie.httpOnly)!;
  const logout = await request.delete("/api/session", { headers: { Origin: baseURL! } });
  expect(logout.status()).toBe(204);
  expect((await request.get("/api/session")).status()).toBe(401);
  const revoked = await fetch(`${fixtures.apiUrl}/auth/me`, { headers: { Authorization: `Bearer ${sessionCookie.value}` } });
  expect(revoked.status).toBe(401);
});

test("cashier cannot read another business line or integration configuration", async ({ request, baseURL }) => {
  const login = await request.post("/api/session", {
    headers: { Origin: baseURL! }, data: { email: fixtures.cashier.email, password: fixtures.cashier.password },
  });
  expect(login.status()).toBe(200);
  const user = (await login.json()).user;
  expect(user.businessLines).toHaveLength(1);
  expect((await request.get(`/api/pos/services?businessLineId=${fixtures.salon.id}`)).status()).toBe(403);
  expect((await request.get("/api/pos/integrations")).status()).toBe(403);
});
