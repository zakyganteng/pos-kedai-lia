import { test, expect, type Page, type Locator } from '@playwright/test';
import { fixtures, noPageOverflow, trackBrowserErrors } from './helpers';

test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true });

async function loginByTouch(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixtures.email);
  await page.getByLabel('Kata sandi', { exact: true }).fill(fixtures.password);
  await page.getByRole('button', { name: 'Masuk', exact: true }).tap();
  await expect(page).toHaveURL(/\/kasir/);
  await expect(page.getByRole('heading', { name: 'Kasir', exact: true })).toBeVisible();
}

async function withinViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function swipeUp(page: Page, area: Locator) {
  const box = (await area.boundingBox())!;
  const session = await page.context().newCDPSession(page);
  await session.send('Input.synthesizeScrollGesture', {
    x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height - 60),
    yDistance: -250, speed: 700, gestureSourceType: 'touch',
  });
  await session.detach();
}

test('landscape tablet uses photo placeholders, large targets and single-tap item selection', async ({ page }) => {
  const errors = trackBrowserErrors(page);
  await loginByTouch(page);
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  const catalog = page.getByRole('region', { name: /^Produk/ });
  const order = page.getByRole('region', { name: 'Pesanan', exact: true });
  const left = (await catalog.boundingBox())!;
  const right = (await order.boundingBox())!;
  expect(left.x + left.width).toBeLessThanOrEqual(right.x);
  await withinViewport(page, page.getByRole('button', { name: 'Lanjut ke pembayaran', exact: true }));
  const images = page.locator('.catalog-item img');
  await expect(images).toHaveCount(20);
  expect(await images.first().getAttribute('width')).toBe('320');
  expect(await images.first().getAttribute('height')).toBe('180');
  await expect.poll(() => images.first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(page.locator('.catalog-image-label').first()).toHaveText('Foto belum tersedia');

  await page.getByLabel('Cari produk', { exact: true }).fill('Produk kasir');
  const card = catalog.getByRole('button', { name: /Tambah.*Produk kasir ke pesanan/ });
  await card.locator('img').tap();
  await expect(page.getByRole('spinbutton', { name: `Jumlah ${fixtures.product.name}`, exact: true })).toHaveValue('1');
  await expect(card).toHaveAttribute('data-selected', 'true');
  await card.tap();
  await expect(page.getByRole('spinbutton', { name: `Jumlah ${fixtures.product.name}`, exact: true })).toHaveValue('2');
  const plus = page.getByRole('button', { name: `Tambah jumlah ${fixtures.product.name}`, exact: true });
  const minus = page.getByRole('button', { name: `Kurangi jumlah ${fixtures.product.name}`, exact: true });
  await plus.tap();
  await expect(page.getByRole('spinbutton', { name: `Jumlah ${fixtures.product.name}`, exact: true })).toHaveValue('3');
  await minus.tap();
  await expect(page.getByRole('spinbutton', { name: `Jumlah ${fixtures.product.name}`, exact: true })).toHaveValue('2');
  for (const control of [plus, minus, page.getByLabel('Cari produk', { exact: true }), page.getByRole('button', { name: `Hapus ${fixtures.product.name}`, exact: true })]) {
    const box = (await control.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(56);
    expect(box.width).toBeGreaterThanOrEqual(56);
  }
  expect((await page.getByRole('button', { name: 'Lanjut ke pembayaran', exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(64);
  await page.getByRole('button', { name: 'Hapus pencarian', exact: true }).tap();
  await expect(images).toHaveCount(20);
  await page.screenshot({ path: 'test-results/boutique-lia-tablet-landscape.png', fullPage: true });
  await page.getByRole('button', { name: 'Kosongkan pesanan', exact: true }).tap();
  await page.getByRole('button', { name: 'Simpan pesanan', exact: true }).tap();
  await expect(page.getByRole('spinbutton', { name: `Jumlah ${fixtures.product.name}`, exact: true })).toHaveValue('2');
  await page.getByRole('button', { name: 'Kosongkan pesanan', exact: true }).tap();
  await page.getByRole('button', { name: 'Ya, kosongkan pesanan', exact: true }).tap();
  await expect(page.getByText('Belum ada item. Pilih produk atau layanan untuk memulai.', { exact: true })).toBeVisible();
  await noPageOverflow(page);
  expect(errors).toEqual([]);
});

test('independent pane scrolling preserves checkout and touch keypad completes a real cash sale', async ({ page }) => {
  const errors = trackBrowserErrors(page);
  await loginByTouch(page);
  const scrollArea = page.getByRole('region', { name: 'Pilihan produk', exact: true });
  const checkout = page.getByRole('button', { name: 'Lanjut ke pembayaran', exact: true });
  const before = (await checkout.boundingBox())!;
  await swipeUp(page, scrollArea);
  await expect.poll(() => scrollArea.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  const after = (await checkout.boundingBox())!;
  expect(Math.abs(after.y - before.y)).toBeLessThan(2);
  await withinViewport(page, checkout);
  await page.getByLabel('Cari produk', { exact: true }).fill('Item halaman');
  await expect(page.locator('.catalog-item')).toHaveCount(18);
  const names = await page.locator('.catalog-item').evaluateAll(elements => elements.slice(0, 8).map(el => el.getAttribute('aria-label')!));
  for (const name of names) await page.getByRole('button', { name, exact: true }).tap();
  const orderArea = page.getByRole('region', { name: 'Item dan pelanggan pesanan', exact: true });
  await expect.poll(() => orderArea.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await swipeUp(page, orderArea);
  await expect.poll(() => orderArea.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await withinViewport(page, checkout);
  await checkout.tap();
  const dialog = page.getByRole('dialog', { name: 'Pembayaran', exact: true });
  const submit = dialog.getByRole('button', { name: 'Selesaikan pembayaran', exact: true });
  const keypad = page.getByRole('group', { name: 'Keypad uang diterima', exact: true });
  await keypad.getByRole('button', { name: 'Masukkan digit 5', exact: true }).tap();
  for (let index = 0; index < 4; index++) await keypad.getByRole('button', { name: 'Masukkan digit 0', exact: true }).tap();
  await expect(page.getByLabel('Uang diterima', { exact: true })).toHaveValue('50000');
  await keypad.getByRole('button', { name: 'Hapus digit terakhir', exact: true }).tap();
  await expect(page.getByLabel('Uang diterima', { exact: true })).toHaveValue('5000');
  await keypad.getByRole('button', { name: 'Hapus nominal', exact: true }).tap();
  await expect(page.getByLabel('Uang diterima', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Uang pas', exact: true }).tap();
  await expect(page.getByLabel('Uang diterima', { exact: true })).toHaveValue('8000');
  await withinViewport(page, submit);
  await page.screenshot({ path: 'test-results/boutique-lia-tablet-payment.png', fullPage: true });
  const responsePromise = page.waitForResponse(response => response.url().includes('/api/pos/sales?') && response.request().method() === 'POST');
  await submit.tap();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const sale = await response.json();
  expect(sale.items).toHaveLength(8);
  expect(sale.total).toBe(8000);
  expect(sale.payment.status).toBe('confirmed');
  await expect(page).toHaveURL(new RegExp(`/struk/${sale.id}$`));
  expect(errors).toEqual([]);
});

test('portrait fallback and reduced-height keyboard layout remain usable', async ({ page }) => {
  const errors = trackBrowserErrors(page);
  await loginByTouch(page);
  await page.getByLabel('Cari produk', { exact: true }).fill('Produk kasir');
  await page.getByRole('button', { name: /Tambah.*Produk kasir ke pesanan/ }).tap();
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.getByRole('heading', { name: 'Pesanan', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Tinjau pesanan', exact: true }).tap();
  await expect(page.getByRole('heading', { name: 'Pesanan', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/boutique-lia-tablet-portrait.png', fullPage: true });
  await page.setViewportSize({ width: 1024, height: 400 });
  await expect(page.getByRole('heading', { name: 'Pesanan', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Lanjut ke pembayaran', exact: true }).tap();
  await page.getByLabel('Uang diterima', { exact: true }).fill('10000');
  await withinViewport(page, page.getByRole('button', { name: 'Selesaikan pembayaran', exact: true }));
  await noPageOverflow(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  for (const viewport of [{ width: 960, height: 640 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('heading', { name: 'Pesanan', exact: true })).toBeVisible();
    await withinViewport(page, page.getByRole('button', { name: 'Lanjut ke pembayaran', exact: true }));
    await noPageOverflow(page);
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await noPageOverflow(page);
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  expect(errors).toEqual([]);
});
