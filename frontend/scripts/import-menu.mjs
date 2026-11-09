#!/usr/bin/env node
// Append catalog records from the supplied menu through the authorized Go API.
// No sales history, inventory quantities, images, or existing-record edits.
import { readFile } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const defaultMenu = resolve(here, '../../data/menu.md');

export function normalizeName(value) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function parseMenu(markdown) {
  let category;
  const items = [];
  const names = new Set();
  const skus = new Set();
  for (const line of markdown.split(/\r?\n/)) {
    if (/^###\s+Daftar Makanan\s*$/.test(line)) { category = 'food'; continue; }
    if (/^###\s+Daftar Minuman\s*$/.test(line)) { category = 'drink'; continue; }
    if (!line.trim().startsWith('|')) continue;
    const cells = line.trim().split('|').slice(1, -1).map(cell => cell.trim());
    if (cells.every(cell => /^:?-+:?$/.test(cell)) || cells[0] === 'Nama Menu') continue;
    if (!category || cells.length !== 2) throw new Error('Unexpected menu table format.');
    const [name, rawPrice] = cells;
    const priceMatch = /^(\d+)(k)?$/i.exec(rawPrice);
    if (!name || name.length > 160 || !priceMatch) throw new Error(`Invalid menu entry: ${name}`);
    const price = Number(priceMatch[1]) * (priceMatch[2] ? 1000 : 1);
    if (!Number.isSafeInteger(price) || price < 0 || price > 1_000_000_000_000) throw new Error(`Invalid price for ${name}`);
    const normalized = normalizeName(name);
    if (names.has(normalized)) throw new Error(`Duplicate menu name: ${name}`);
    names.add(normalized);
    const slug = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase();
    const sku = `MENU-${category === 'food' ? 'F' : 'D'}-${slug}`;
    if (!slug || sku.length > 80) throw new Error(`Invalid generated SKU for ${name}`);
    if (skus.has(sku)) throw new Error(`Duplicate generated SKU: ${sku}`);
    skus.add(sku);
    // The price list does not specify packaging/serving units: use neutral "item".
    items.push({ category, sku, name, price, unit: 'item', stockTracked: false });
  }
  if (items.length === 0) throw new Error('No menu products were found.');
  return items;
}

export function planImport(items, existing) {
  return items.map(item => {
    const skuMatch = existing.find(product => product.sku === item.sku);
    if (skuMatch && normalizeName(skuMatch.name) !== normalizeName(item.name)) {
      throw new Error(`SKU ${item.sku} already belongs to a different product; nothing will be overwritten.`);
    }
    const matches = existing.filter(product => normalizeName(product.name) === normalizeName(item.name));
    if (matches.length > 1) throw new Error(`More than one existing product matches ${item.name}; inspect it before importing.`);
    return { item, existing: skuMatch ?? matches[0] ?? null };
  });
}

async function run() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply')) throw new Error('Usage: node scripts/import-menu.mjs [--apply]');
  const apply = args.includes('--apply');
  const email = process.env.POS_IMPORT_EMAIL;
  const password = process.env.POS_IMPORT_PASSWORD;
  if (!email || !password) throw new Error('Set POS_IMPORT_EMAIL and POS_IMPORT_PASSWORD for an authorized owner/admin account.');
  const base = new URL(process.env.POS_API_URL || 'http://127.0.0.1:8080/api/v1');
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error('POS_API_URL must be an HTTP(S) API base URL without credentials, query, or fragment.');
  }
  const apiUrl = base.toString().replace(/\/$/, '');
  const menuFile = process.env.POS_MENU_FILE || defaultMenu;
  const items = parseMenu(await readFile(menuFile, 'utf8'));
  let token;
  async function request(path, body) {
    const response = await fetch(`${apiUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!response.ok) throw new Error(`${path.split('?')[0]}: HTTP ${response.status} ${data?.error?.code || ''}`);
    return data;
  }
  try {
    const session = await request('/auth/login', { email, password });
    token = session.accessToken;
    if (!['owner', 'admin'].includes(session.user.role)) throw new Error('Catalog import requires an owner or admin.');
    const business = session.user.businessLines.find(line => line.code === 'kedai-lia-287' && line.type === 'food_beverage');
    if (!business) throw new Error('This account is not assigned to Kedai Lia 287.');
    const listPath = `/products?businessLineId=${encodeURIComponent(business.id)}`;
    async function allProducts() {
      const products = [];
      for (let page = 1; page <= 10000; page++) {
        const result = await request(`${listPath}&page=${page}&limit=100`);
        if (!Array.isArray(result.data) || !result.pagination) throw new Error('Unexpected product-page response.');
        products.push(...result.data);
        if (page >= result.pagination.totalPages) return products;
      }
      throw new Error('Product pagination exceeded the safety bound.');
    }
    const activeCategories = [];
    for (let page = 1; page <= 10000; page++) {
      const result = await request(`/categories?businessLineId=${encodeURIComponent(business.id)}&active=true&page=${page}&limit=100`);
      activeCategories.push(...result.data);
      if (page >= result.pagination.totalPages) break;
      if (page === 10000) throw new Error('Category pagination exceeded the safety bound.');
    }
    const categoryIds = {
      food: activeCategories.find(category => normalizeName(category.name) === 'makanan')?.id,
      drink: activeCategories.find(category => normalizeName(category.name) === 'minuman')?.id,
    };
    for (const [group, id] of Object.entries(categoryIds)) {
      if (!id) console.log(`No active default category for ${group}; new items in that group will remain unassigned. Existing assignments are preserved.`);
    }
    const plan = planImport(items, await allProducts());
    console.log(`${business.name}: ${items.filter(item => item.category === 'food').length} foods, ${items.filter(item => item.category === 'drink').length} drinks from ${basename(menuFile)}.`);
    const missing = plan.filter(entry => entry.existing === null);
    console.log(`${apply ? 'Apply' : 'Dry run'}: ${missing.length} new products; ${plan.length - missing.length} existing products left untouched.`);
    let created = 0;
    for (const { item, existing } of plan) {
      if (existing) {
        if (existing.price !== item.price || !existing.active) console.log(`Preserved existing ${item.name}: price/status differs from the supplied menu.`);
        continue;
      }
      if (!apply) continue;
      const input = { sku: item.sku, name: item.name, price: item.price, unit: item.unit, stockTracked: item.stockTracked,
        ...(categoryIds[item.category] ? { categoryId: categoryIds[item.category] } : {}),
      };
      const product = await request(listPath, input);
      if (product.name !== item.name || product.price !== item.price || product.businessLineId !== business.id) {
        throw new Error(`Unexpected saved product for ${item.name}; inspect before continuing.`);
      }
      created++;
      console.log(`Added ${product.name}: IDR ${product.price}`);
    }
    if (apply) {
      const saved = await allProducts();
      for (const { item, existing } of plan) {
        if (existing) continue;
        const product = saved.find(product => product.sku === item.sku);
        if (!product || product.price !== item.price || !product.active || product.stockTracked ||
            (categoryIds[item.category] && product.categoryId !== categoryIds[item.category])) throw new Error(`Verification failed for ${item.name}`);
      }
      console.log(`Verified ${created} new active products. No sales or inventory movements were created.`);
    }
  } finally {
    if (token) {
      try { await request('/auth/logout', {}); }
      catch { console.error('Warning: import-session revocation could not be confirmed; it will expire normally.'); }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => {
    console.error(error.message);
    console.error('Import stopped. Do not blindly retry a failed create; rerun the dry-run lookup to inspect saved products first.');
    process.exitCode = 1;
  });
}
