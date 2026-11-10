import { test, expect, type Page } from "@playwright/test";
import { fixtures, noPageOverflow, trackBrowserErrors } from "./helpers";

/** Waits for the dev server to finish compiling and hydrating before submitting. */
async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Kata sandi", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page).toHaveURL(/\/kasir/, { timeout: 30_000 });
}

const ownerLogin = (page: Page) => signIn(page, fixtures.email, fixtures.password);

async function chooseLine(page: Page, name: string) {
  await page.getByLabel("Unit usaha", { exact: true }).selectOption({ label: name });
}

async function openNav(page: Page, label: string) {
  await page.getByRole("navigation", { name: "Navigasi utama" }).getByRole("link", { name: label, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test("owner reaches every management screen on both lines without errors", async ({ page }) => {
  const errors = trackBrowserErrors(page);
  await ownerLogin(page);

  await chooseLine(page, fixtures.kedai.name);
  for (const [label, heading] of [
    ["Struk", "Struk"], ["Laporan", "Laporan"], ["Stok", "Stok"], ["Katalog", "Katalog"],
    ["Pelanggan", "Pelanggan"], ["Staf", "Staf"], ["Notifikasi", "Notifikasi"],
    ["Rekonsiliasi", "Rekonsiliasi"], ["Pengguna", "Pengguna"], ["Sistem", "Sistem"],
  ]) {
    await openNav(page, label);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.locator(".notice-error")).toHaveCount(0);
    await noPageOverflow(page);
  }
  await expect(page.getByRole("navigation", { name: "Navigasi utama" }).getByRole("link", { name: "Antrean" })).toHaveCount(0);

  await chooseLine(page, fixtures.salon.name);
  await openNav(page, "Antrean");
  await expect(page.getByRole("heading", { level: 1, name: "Antrean" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Navigasi utama" }).getByRole("link", { name: "Stok" })).toHaveCount(0);
  await openNav(page, "Katalog");
  await expect(page.getByRole("cell", { name: "[UJI E2E] Layanan salon", exact: true })).toBeVisible();

  await openNav(page, "Sistem");
  await expect(page.getByText(/Tidak siap|Siap/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("product admin, stock receipt and the stock ledger persist through the API", async ({ page }) => {
  const errors = trackBrowserErrors(page);
  const request = page.request;
  await ownerLogin(page);
  await chooseLine(page, fixtures.kedai.name);

  await openNav(page, "Katalog");
  await page.getByRole("tab", { name: "Produk" }).click();
  await page.getByRole("button", { name: "Tambah produk" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("SKU", { exact: true }).fill("E2E-ADMIN");
  await dialog.getByLabel("Nama produk", { exact: true }).fill("[UJI E2E] Produk admin");
  await dialog.getByLabel("Satuan", { exact: true }).fill("botol");
  await dialog.getByLabel("Harga (Rp)", { exact: true }).fill("12500");
  await dialog.getByLabel(/Lacak stok|stok/i).first().check();
  await dialog.getByRole("button", { name: "Simpan produk" }).click();
  await expect(dialog).toBeHidden();
  await page.getByLabel("Cari produk", { exact: true }).fill("Produk admin");
  await expect(page.getByRole("cell", { name: "[UJI E2E] Produk admin", exact: true })).toBeVisible();

  await openNav(page, "Stok");
  await page.getByRole("button", { name: "Catat penerimaan / penyesuaian" }).click();
  const move = page.getByRole("dialog");
  await move.getByLabel("Produk", { exact: true }).selectOption({ label: "[UJI E2E] Produk admin · E2E-ADMIN" });
  await move.getByLabel(/^Jumlah/).fill("7");
  await move.getByLabel("Alasan", { exact: true }).fill("[UJI E2E] penerimaan UI");
  await move.getByRole("button", { name: "Simpan pergerakan" }).click();
  await expect(move).toBeHidden();
  await expect(page.getByRole("row", { name: /\[UJI E2E\] Produk admin/ })).toContainText("7");

  await page.getByRole("tab", { name: "Riwayat pergerakan" }).click();
  await expect(page.getByRole("row", { name: /\[UJI E2E\] penerimaan UI/ })).toBeVisible();

  const products = await request.get(`/api/pos/products?businessLineId=${fixtures.kedai.id}&search=E2E-ADMIN`);
  const created = (await products.json()).data[0];
  expect(created.price).toBe(12500);
  expect(created.stockTracked).toBe(true);
  expect(created.stockOnHand).toBe(7);
  expect(errors).toEqual([]);
});

test("customers, staff and the salon queue run through their full flow", async ({ page }) => {
  const errors = trackBrowserErrors(page);
  await ownerLogin(page);
  await chooseLine(page, fixtures.salon.name);

  await openNav(page, "Pelanggan");
  await page.getByRole("button", { name: /^Tambah pelanggan/ }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nama", { exact: true }).fill("[UJI E2E] Pelanggan salon");
  await dialog.getByLabel("Nomor telepon (opsional)", { exact: true }).fill("081234567890");
  await dialog.getByRole("button", { name: /^Simpan/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("cell", { name: "[UJI E2E] Pelanggan salon" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "+6281234567890" })).toBeVisible();

  await openNav(page, "Staf");
  await page.getByRole("button", { name: /^Tambah staf/ }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nama", { exact: true }).fill("[UJI E2E] Staf kedua");
  await dialog.getByRole("button", { name: /^Simpan/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("cell", { name: "[UJI E2E] Staf kedua" })).toBeVisible();

  await openNav(page, "Antrean");
  await page.getByRole("button", { name: "Tambah antrean" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: /\[UJI E2E\] Layanan salon/ }).check();
  await dialog.getByLabel("Staf (opsional)", { exact: true }).selectOption({ label: "[UJI E2E] Staf salon" });
  await dialog.getByRole("button", { name: "Tambah ke antrean" }).click();
  await expect(dialog).toBeHidden();
  const card = page.locator("article, li").filter({ hasText: "[UJI E2E] Layanan salon" }).first();
  await expect(card).toContainText("Menunggu");
  await card.getByRole("button", { name: /Mulai layanan/ }).click();
  await expect(card).toContainText("Sedang dilayani");
  await card.getByRole("button", { name: /^Selesai/ }).click();
  await expect(card).toContainText("Selesai");
  await expect(card.getByRole("button", { name: /Tautkan transaksi/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a confirmed cash sale is voided, leaves reports, and CSV export downloads", async ({ page }) => {
  const errors = trackBrowserErrors(page);
  const request = page.request;
  await ownerLogin(page);
  await chooseLine(page, fixtures.kedai.name);

  const sale = await request.post(`/api/pos/sales?businessLineId=${fixtures.kedai.id}`, {
    headers: { Origin: new URL(page.url()).origin, "X-Idempotency-Key": `void-${Date.now()}` },
    data: { items: [{ itemType: "product", itemId: fixtures.product.id, quantity: 2 }], paymentMethod: "cash", cashReceived: 20000 },
  });
  expect(sale.status()).toBe(201);
  const saleId = (await sale.json()).id;

  await openNav(page, "Laporan");
  await expect(page.getByText("Jumlah transaksi")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh CSV" }).click();
  expect((await download).suggestedFilename()).toMatch(/^penjualan-.*\.csv$/);

  await page.goto(`/struk/${saleId}`);
  await page.getByRole("button", { name: "Batalkan transaksi" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Alasan pembatalan", { exact: true }).fill("[UJI E2E] salah input");
  await dialog.getByRole("button", { name: "Batalkan transaksi" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/dibatalkan setelah pembayaran/i).first()).toBeVisible();
  const after = await request.get(`/api/pos/sales/${saleId}`);
  expect((await after.json()).status).toBe("voided");
  expect(errors).toEqual([]);
});

test("owner creates a user; cashier sees read-only screens and no admin links", async ({ page }) => {
  const errors = trackBrowserErrors(page);
  await ownerLogin(page);
  await openNav(page, "Pengguna");
  await page.getByRole("button", { name: "Tambah pengguna" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nama", { exact: true }).fill("[UJI E2E] Admin baru");
  await dialog.getByLabel("Email", { exact: true }).fill("admin-baru-e2e@example.test");
  await dialog.getByLabel("Kata sandi", { exact: true }).fill("admin-baru-password-1");
  await dialog.getByLabel("Peran", { exact: true }).selectOption("admin");
  await dialog.getByRole("checkbox", { name: fixtures.kedai.name }).check();
  await dialog.getByRole("button", { name: "Buat akun" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("cell", { name: "admin-baru-e2e@example.test" })).toBeVisible();
  await page.getByRole("button", { name: "Keluar", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);

  await signIn(page, fixtures.cashier.email, fixtures.cashier.password);
  const nav = page.getByRole("navigation", { name: "Navigasi utama" });
  for (const hidden of ["Katalog", "Notifikasi", "Rekonsiliasi", "Pengguna", "Sistem", "Antrean"]) {
    await expect(nav.getByRole("link", { name: hidden, exact: true })).toHaveCount(0);
  }
  await openNav(page, "Stok");
  await expect(page.getByRole("button", { name: "Catat penerimaan / penyesuaian" })).toHaveCount(0);
  await openNav(page, "Staf");
  await expect(page.getByRole("button", { name: /^Tambah staf/ })).toHaveCount(0);
  await openNav(page, "Laporan");
  await expect(page.getByRole("button", { name: "Unduh CSV" })).toHaveCount(0);
  await page.goto("/pengguna");
  await expect(page.getByText("Akun ini tidak memiliki akses")).toBeVisible();
  expect(errors).toEqual([]);
});
