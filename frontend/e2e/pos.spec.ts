import { test, expect, type Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { fixtures, ownerLogin, noPageOverflow, trackBrowserErrors } from "./helpers";

async function addProduct(page: Page) {
  await page.getByLabel("Cari produk", { exact: true }).fill("Produk kasir");
  await page.getByRole("region", { name: /^Produk/ }).getByRole("button", { name: new RegExp(fixtures.product.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click();
}
async function openCash(page: Page, amount = "10000") {
  await page.getByRole("button", { name: "Lanjut ke pembayaran", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("Uang diterima", { exact: true }).fill(amount);
}
function saleResponse(page: Page) {
  return page.waitForResponse(response => response.url().includes("/api/pos/sales?") && response.request().method() === "POST");
}

test("login validation, cash quantity/customer/change, persisted receipt, print, clean next order", async ({ page }) => {
  const errors = trackBrowserErrors(page);
  await page.goto("/login");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toBeVisible();
  await ownerLogin(page);
  await expect(page.getByRole("heading", { name: "Kasir", exact: true })).toBeVisible();
  const family = await page.locator("body").evaluate(el => getComputedStyle(el).fontFamily);
  expect(family.toLowerCase()).not.toContain("times new roman");
  await page.getByLabel("Cari produk", { exact: true }).fill("TIDAK-ADA-UJI");
  await expect(page.getByText("Tidak ada hasil untuk pencarian ini.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Hapus pencarian", exact: true }).first().click();
  await addProduct(page);
  await page.getByRole("spinbutton", { name: `Jumlah ${fixtures.product.name}`, exact: true }).fill("2");
  await page.getByRole("button", { name: "Pilih pelanggan", exact: true }).click();
  await page.getByRole("dialog", { name: "Pilih pelanggan", exact: true }).getByRole("button", { name: /Pelanggan kasir/ }).click();
  await openCash(page, "15000");
  await expect(page.getByRole("button", { name: "Selesaikan pembayaran", exact: true })).toBeDisabled();
  await page.getByLabel("Uang diterima", { exact: true }).fill("25000");
  const responsePromise = saleResponse(page);
  await page.getByRole("button", { name: "Selesaikan pembayaran", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const sale = await response.json();
  expect(sale.total).toBe(20000);
  expect(sale.changeDue).toBe(5000);
  expect(sale.customerId).toBe(fixtures.customer.id);
  expect(sale.payment.status).toBe("confirmed");
  await expect(page).toHaveURL(new RegExp(`/struk/${sale.id}$`));
  await expect(page.getByRole("article")).toContainText(fixtures.product.name);
  await expect(page.getByRole("button", { name: "Cetak struk", exact: true })).toBeEnabled();
  await page.evaluate(() => { window.print = () => { document.body.dataset.printCalled = "yes"; }; });
  await page.getByRole("button", { name: "Cetak struk", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-print-called", "yes");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".app-header")).toBeHidden();
  await expect(page.locator(".receipt")).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("link", { name: "Kembali ke kasir", exact: true }).click();
  await expect(page.getByText("Belum ada item. Pilih produk atau layanan untuk memulai.", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Struk", exact: true }).click();
  await page.getByLabel("Status transaksi", { exact: true }).selectOption("paid");
  await expect(page.locator(`a[href="/struk/${sale.id}"]`)).toBeVisible();
  await page.getByRole("button", { name: "Hapus filter", exact: true }).click();
  await page.locator(`a[href="/struk/${sale.id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/struk/${sale.id}$`));
  await expect(page.getByRole("article")).toBeVisible();
  await noPageOverflow(page);
  await page.screenshot({ path: "test-results/boutique-lia-receipt-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 360, height: 780 });
  await noPageOverflow(page);
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await noPageOverflow(page);
  await page.getByRole("region", { name: "Rincian item struk", exact: true }).focus();
  await expect(page.getByRole("region", { name: "Rincian item struk", exact: true })).toBeFocused();
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  expect(errors).toEqual([]);
});

test("business switch confirms preserved draft; salon checkout needs no staff", async ({ page }) => {
  const errors = trackBrowserErrors(page);
  await ownerLogin(page);
  await addProduct(page);
  await page.getByLabel("Unit usaha", { exact: true }).selectOption(fixtures.salon.id);
  await expect(page.getByRole("dialog", { name: "Pindah unit usaha?", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByLabel("Unit usaha", { exact: true })).toHaveValue(fixtures.kedai.id);
  await page.getByLabel("Unit usaha", { exact: true }).selectOption(fixtures.salon.id);
  await page.getByRole("button", { name: `Pindah ke ${fixtures.salon.name}`, exact: true }).click();
  await page.getByRole("button", { name: new RegExp("Layanan salon") }).click();
  await expect(page.getByLabel(/staf/i)).toHaveCount(0);
  await openCash(page, "25000");
  const responsePromise = saleResponse(page);
  await page.getByRole("button", { name: "Selesaikan pembayaran", exact: true }).click();
  const sale = await (await responsePromise).json();
  expect(sale.businessLineId).toBe(fixtures.salon.id);
  expect(sale.items[0].staffId).toBeNull();
  await expect(page).toHaveURL(new RegExp(`/struk/${sale.id}$`));
  await expect(page.getByRole("article")).not.toContainText(/staf/i);
  await page.getByRole("link", { name: "Kembali ke kasir", exact: true }).click();
  await page.getByLabel("Unit usaha", { exact: true }).selectOption(fixtures.kedai.id);
  await expect(page.getByRole("spinbutton", { name: `Jumlah ${fixtures.product.name}`, exact: true })).toHaveValue("1");
  expect(errors).toEqual([]);
});

test("legacy frozen checkout stays blocked for receipt review instead of risking a duplicate", async ({ page }) => {
  const errors = trackBrowserErrors(page);
  await ownerLogin(page);
  await page.getByLabel("Unit usaha", { exact: true }).selectOption(fixtures.salon.id);
  await page.getByRole("button", { name: new RegExp("Layanan salon") }).click();
  await openCash(page, "25000");
  await page.route("**/api/pos/sales?**", async route => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Selesaikan pembayaran", exact: true }).click();
  await expect(page.getByText("Hasil permintaan pembayaran belum diketahui", { exact: true }).first()).toBeVisible();
  await page.unroute("**/api/pos/sales?**");
  const key = await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find(key => key.includes("checkout."));
    if (!key) throw new Error("Missing frozen checkout");
    const attempt = JSON.parse(sessionStorage.getItem(key)!);
    attempt.body.items[0].staffId = "11111111-2222-4333-8444-555555555555";
    sessionStorage.setItem(key, JSON.stringify(attempt));
    return key;
  });
  await page.reload();
  await expect(page.getByText("Permintaan lama perlu diperiksa", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Kirim ulang permintaan yang sama", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Lanjut ke pembayaran", exact: true })).toBeDisabled();
  await page.getByText("Permintaan ini sudah saya periksa dan tidak ada transaksinya", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Buang permintaan ini", exact: true })).toBeDisabled();
  expect(await page.evaluate(key => sessionStorage.getItem(key), key)).not.toBeNull();
  await page.getByRole("link", { name: "Periksa daftar struk", exact: true }).click();
  await expect(page).toHaveURL(/\/struk$/);
  expect(await page.evaluate(key => sessionStorage.getItem(key), key)).not.toBeNull();
  expect(errors).toEqual([]);
});

test("lost successful response survives reload and re-login, retry creates exactly one sale", async ({ page }) => {
  const errors = trackBrowserErrors(page);
  await ownerLogin(page);
  await addProduct(page);
  await openCash(page);
  let committedSale: { id: string } | null = null;
  let originalKey: string | undefined;
  const before = await page.request.get(`/api/pos/sales?businessLineId=${fixtures.kedai.id}&limit=100`);
  const beforeCount = (await before.json()).pagination.total;
  await page.route("**/api/pos/sales?**", async route => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    originalKey = route.request().headers()["x-idempotency-key"];
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    committedSale = await response.json();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Selesaikan pembayaran", exact: true }).click();
  await expect(page.getByText("Hasil permintaan pembayaran belum diketahui", { exact: true }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.unroute("**/api/pos/sales?**");
  await page.reload();
  await expect(page.getByRole("button", { name: "Lanjut ke pembayaran", exact: true })).toBeDisabled();
  // Expired/lost cookie, then original user logs in again. Local recovery key remains.
  await page.context().clearCookies();
  await page.reload();
  await expect(page).toHaveURL(/\/login/);
  await ownerLogin(page);
  await expect(page.getByRole("button", { name: "Kirim ulang permintaan yang sama", exact: true })).toBeVisible();
  const retryPromise = saleResponse(page);
  await page.getByRole("button", { name: "Kirim ulang permintaan yang sama", exact: true }).click();
  const retriedResponse = await retryPromise;
  expect(retriedResponse.request().headers()["x-idempotency-key"]).toBe(originalKey);
  const retried = await retriedResponse.json();
  expect(committedSale).not.toBeNull();
  expect(retried.id).toBe(committedSale!.id);
  await expect(page).toHaveURL(new RegExp(`/struk/${retried.id}$`));
  const after = await page.request.get(`/api/pos/sales?businessLineId=${fixtures.kedai.id}&limit=100`);
  expect((await after.json()).pagination.total).toBe(beforeCount + 1);
  expect(errors).toEqual([]);
});

test("QRIS remains pending through failed status check, confirms only from signed provider event", async ({ page }) => {
  const errors = trackBrowserErrors(page);
  await ownerLogin(page);
  await addProduct(page);
  await page.getByRole("button", { name: "Lanjut ke pembayaran", exact: true }).click();
  await page.getByRole("radio", { name: /^QRIS/ }).check();
  const responsePromise = saleResponse(page);
  await page.getByRole("button", { name: "Selesaikan pembayaran", exact: true }).click();
  const sale = await (await responsePromise).json();
  expect(sale.payment.status).toBe("pending");
  await expect(page).toHaveURL(new RegExp(`/struk/${sale.id}$`));
  await expect(page.getByText(/Kode uji coba, bukan QRIS yang dapat dibayar/)).toBeVisible();
  await expect(page.locator(".qr-frame img")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cetak struk", exact: true })).toBeDisabled();
  await page.route(`**/api/pos/sales/${sale.id}`, route => route.fulfill({
    status: 502, contentType: "application/json", body: JSON.stringify({ error: { code: "UPSTREAM_UNAVAILABLE", message: "[UJI E2E] pemeriksaan sementara gagal" } }),
  }));
  await page.getByRole("button", { name: "Periksa status sekarang", exact: true }).click();
  await expect(page.getByText("Status pembayaran belum dapat diperiksa.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cetak struk", exact: true })).toBeDisabled();
  await page.unroute(`**/api/pos/sales/${sale.id}`);
  const event = {
    eventId: randomUUID(), paymentId: sale.payment.gatewayReference, merchantReference: sale.id,
    amount: sale.total, currency: "IDR", status: "succeeded", occurredAt: new Date().toISOString(),
  };
  const raw = JSON.stringify(event);
  const webhook = await fetch(`${fixtures.apiUrl}/webhooks/payments/mock`, {
    method: "POST", body: raw,
    headers: { "Content-Type": "application/json", "X-Idempotency-Key": event.eventId, "X-Webhook-Signature": createHmac("sha256", fixtures.secret).update(raw).digest("hex") },
  });
  expect(webhook.status).toBe(200);
  await page.getByRole("button", { name: "Periksa status sekarang", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cetak struk", exact: true })).toBeEnabled();
  await expect(page.locator(".qr-frame")).toBeHidden();
  expect(errors).toEqual([]);
});

test("mobile/tablet/desktop reflow, touch targets, focus, dialog Escape and catalog retry", async ({ page }) => {
  const errors = trackBrowserErrors(page);
  await page.setViewportSize({ width: 360, height: 780 });
  await ownerLogin(page);
  await addProduct(page);
  await page.getByRole("button", { name: "Tinjau pesanan", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pesanan", exact: true })).toBeVisible();
  await openCash(page);
  await page.keyboard.press("Tab");
  expect(await page.getByRole("dialog").evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Shift+Tab");
  expect(await page.getByRole("dialog").evaluate(el => el.contains(document.activeElement))).toBe(true);
  await noPageOverflow(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Kembali ke katalog", exact: true }).click();
  await page.getByLabel("Cari produk", { exact: true }).fill("nama panjang");
  await page.getByRole("button", { name: /Produk dengan nama panjang/ }).click();
  await page.getByRole("button", { name: "Tinjau pesanan", exact: true }).click();
  await noPageOverflow(page);
  await page.screenshot({ path: "test-results/boutique-lia-kasir-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Kembali ke katalog", exact: true }).click();
  for (const width of [640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await noPageOverflow(page);
  }
  await page.getByRole("button", { name: "Hapus pencarian", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Berikutnya", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Berikutnya", exact: true }).click();
  await expect(page.getByText("Halaman 2 dari 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sebelumnya", exact: true }).click();
  await expect(page.getByText("Halaman 1 dari 2", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/boutique-lia-kasir-desktop.png", fullPage: true });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await noPageOverflow(page);
  await page.setViewportSize({ width: 360, height: 780 });
  await noPageOverflow(page);
  await page.getByRole("button", { name: "Tinjau pesanan", exact: true }).click();
  await noPageOverflow(page);
  await openCash(page, "30000");
  await noPageOverflow(page);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Kembali ke katalog", exact: true }).click();
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel("Cari produk", { exact: true }).focus();
  await expect(page.getByLabel("Cari produk", { exact: true })).toBeFocused();
  const focusStyle = await page.getByLabel("Cari produk", { exact: true }).evaluate(el => getComputedStyle(el).outlineStyle);
  expect(focusStyle).not.toBe("none");
  const dimensions = await page.getByRole("button", { name: "Lanjut ke pembayaran", exact: true }).boundingBox();
  expect(dimensions!.height).toBeGreaterThanOrEqual(44);
  await page.route("**/api/pos/products?**", route => route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: { code: "UPSTREAM_UNAVAILABLE", message: "[UJI E2E] katalog tidak tersedia" } }) }));
  await page.reload();
  await expect(page.getByText("Daftar produk belum dapat dimuat.", { exact: true })).toBeVisible();
  await page.unroute("**/api/pos/products?**");
  await page.getByRole("button", { name: "Coba lagi", exact: true }).click();
  await page.getByLabel("Cari produk", { exact: true }).fill("Produk kasir");
  await expect(page.getByRole("region", { name: /^Produk/ }).getByRole("button", { name: /Produk kasir/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("logout preserves original-user recovery but another cashier cannot inherit it", async ({ page }) => {
  const errors = trackBrowserErrors(page);
  await ownerLogin(page);
  await addProduct(page);
  await openCash(page);
  await page.route("**/api/pos/sales?**", async route => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    await route.fulfill({ status: 504, contentType: "application/json", body: JSON.stringify({ error: { code: "REQUEST_UNRESOLVED", message: "[UJI E2E] jawaban tidak tersedia" } }) });
  });
  await page.getByRole("button", { name: "Selesaikan pembayaran", exact: true }).click();
  await expect(page.getByText("Hasil permintaan pembayaran belum diketahui", { exact: true }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.unroute("**/api/pos/sales?**");
  await page.getByRole("button", { name: "Keluar", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /^Masih ada permintaan pembayaran/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/kasir/);
  await page.getByRole("button", { name: "Keluar", exact: true }).click();
  await page.getByRole("button", { name: "Keluar sekarang", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email", { exact: true }).fill(fixtures.cashier.email);
  await page.getByLabel("Kata sandi", { exact: true }).fill(fixtures.cashier.password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page).toHaveURL(/\/kasir/);
  await expect(page.getByRole("button", { name: "Kirim ulang permintaan yang sama", exact: true })).toHaveCount(0);
  await expect(page.getByText("Belum ada item. Pilih produk atau layanan untuk memulai.", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Unit usaha", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Keluar", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await ownerLogin(page);
  await expect(page.getByRole("button", { name: "Kirim ulang permintaan yang sama", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("known unavailable QRIS and stock rejection leave the order recoverable", async ({ page }) => {
  const errors = trackBrowserErrors(page);
  await ownerLogin(page);
  await page.getByLabel("Cari produk", { exact: true }).fill("stok terbatas");
  await page.getByRole("region", { name: /^Produk/ }).getByRole("button", { name: /Produk stok terbatas/ }).click();
  await page.getByRole("spinbutton", { name: `Jumlah ${fixtures.tracked.name}`, exact: true }).fill("11");
  await openCash(page, "200000");
  const rejectedPromise = saleResponse(page);
  await page.getByRole("button", { name: "Selesaikan pembayaran", exact: true }).click();
  expect((await rejectedPromise).status()).toBe(409);
  await expect(page.getByText("Server menolak permintaan ini karena bentrok keadaan", { exact: true }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  // The rejection is conservative: a conflict requires inspecting records, not silently retrying a new key.
  await page.getByRole("link", { name: "Periksa daftar struk", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Struk", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Kasir", exact: true }).click();
  const summary = page.locator("summary").filter({ hasText: "Permintaan ini sudah saya periksa" });
  await summary.click();
  await page.getByRole("checkbox", { name: /Saya sudah membuka daftar struk/ }).check();
  await page.getByRole("button", { name: "Buang permintaan ini", exact: true }).click();
  await page.getByRole("spinbutton", { name: `Jumlah ${fixtures.tracked.name}`, exact: true }).fill("1");
  await page.getByRole("button", { name: "Lanjut ke pembayaran", exact: true }).click();
  await page.getByRole("radio", { name: /^QRIS/ }).check();
  await page.route("**/api/pos/sales?**", async route => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "PAYMENT_UNAVAILABLE", message: "[UJI E2E] penyedia dinonaktifkan" } }) });
  });
  await page.getByRole("button", { name: "Selesaikan pembayaran", exact: true }).click();
  await expect(page.getByText("Tidak ada transaksi yang dibuat. Perbaiki pesanan lalu kirim lagi.", { exact: true })).toBeVisible();
  await page.unroute("**/api/pos/sales?**");
  await page.getByRole("button", { name: "Perbaiki pesanan", exact: true }).click();
  await expect(page.getByRole("button", { name: "Lanjut ke pembayaran", exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});
