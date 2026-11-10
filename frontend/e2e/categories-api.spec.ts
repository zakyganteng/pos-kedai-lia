import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { fixtures } from './helpers';

async function signIn(request: APIRequestContext, origin: string, cashier = false) {
  const credentials = cashier ? { email: fixtures.cashier.email, password: fixtures.cashier.password } : { email: fixtures.email, password: fixtures.password };
  expect((await request.post('/api/session', { headers: { Origin: origin }, data: credentials })).status()).toBe(200);
}

async function findProduct(request: APIRequestContext, id: string) {
  const response = await request.get(`/api/pos/products?businessLineId=${fixtures.kedai.id}&limit=100`);
  expect(response.status()).toBe(200);
  return (await response.json()).data.find((product: { id: string }) => product.id === id);
}

async function createCategory(request: APIRequestContext, origin: string) {
  const name = `[UJI E2E] Kategori ${randomUUID()}`;
  const response = await request.post(`/api/pos/categories?businessLineId=${fixtures.kedai.id}`, { headers: { Origin: origin }, data: { name } });
  expect(response.status()).toBe(201);
  return response.json();
}

test('categories and product filters are persisted and scoped to the kedai', async ({ request, baseURL }) => {
  await signIn(request, baseURL!);
  const response = await request.get(`/api/pos/categories?businessLineId=${fixtures.kedai.id}&active=true&limit=100`);
  expect(response.status()).toBe(200);
  const rows = (await response.json()).data;
  for (const name of ['Makanan', 'Minuman', 'Snack']) expect(rows.some((category: { name: string }) => category.name === name)).toBe(true);
  const food = await request.get(`/api/pos/products?businessLineId=${fixtures.kedai.id}&categoryId=${fixtures.categories.makanan.id}&limit=100`);
  expect((await food.json()).data.every((product: { categoryId: string }) => product.categoryId === fixtures.categories.makanan.id)).toBe(true);
  const unassigned = await request.get(`/api/pos/products?businessLineId=${fixtures.kedai.id}&uncategorized=true&limit=100`);
  expect((await unassigned.json()).data.some((product: { id: string }) => product.id === fixtures.uncategorizedProduct.id)).toBe(true);
  expect((await request.get(`/api/pos/products?businessLineId=${fixtures.kedai.id}&categoryId=${fixtures.categories.makanan.id}&uncategorized=true`)).status()).toBe(400);
  expect((await request.get(`/api/pos/categories?businessLineId=${fixtures.salon.id}`)).status()).toBe(400);
  expect((await request.get(`/api/pos/services?businessLineId=${fixtures.salon.id}&categoryId=${fixtures.categories.makanan.id}`)).status()).toBe(400);
});

test('category CRUD preserves product price and guards used-category archival', async ({ request, baseURL }) => {
  await signIn(request, baseURL!);
  const category = await createCategory(request, baseURL!);
  const original = await findProduct(request, fixtures.uncategorizedProduct.id);
  const renamed = await request.patch(`/api/pos/categories/${category.id}`, { headers: { Origin: baseURL! }, data: { name: `${category.name} Baru` } });
  expect(renamed.status()).toBe(200);
  const assigned = await request.patch(`/api/pos/products/${original.id}`, { headers: { Origin: baseURL! }, data: { categoryId: category.id } });
  expect(assigned.status()).toBe(200);
  const saved = await assigned.json();
  expect(saved.categoryId).toBe(category.id);
  expect(saved.price).toBe(original.price);
  expect(saved.stockTracked).toBe(original.stockTracked);
  const inUse = await request.get(`/api/pos/categories/${category.id}`);
  expect((await inUse.json()).productCount).toBe(1);
  expect((await request.delete(`/api/pos/categories/${category.id}`, { headers: { Origin: baseURL! } })).status()).toBe(409);
  expect((await request.patch(`/api/pos/categories/${category.id}`, { headers: { Origin: baseURL! }, data: { active: false } })).status()).toBe(409);
  expect((await request.patch(`/api/pos/products/${original.id}`, { headers: { Origin: baseURL! }, data: { categoryId: null } })).status()).toBe(200);
  expect((await request.delete(`/api/pos/categories/${category.id}`, { headers: { Origin: baseURL! } })).status()).toBe(204);
  expect((await (await request.get(`/api/pos/categories/${category.id}`)).json()).active).toBe(false);
  expect((await request.patch(`/api/pos/products/${original.id}`, { headers: { Origin: baseURL! }, data: { categoryId: category.id } })).status()).toBe(409);
  const restored = await request.patch(`/api/pos/categories/${category.id}`, { headers: { Origin: baseURL! }, data: { active: true } });
  expect(restored.status()).toBe(200);
  expect((await restored.json()).active).toBe(true);
  expect((await request.delete(`/api/pos/categories/${category.id}`, { headers: { Origin: baseURL! } })).status()).toBe(204);
});

test('duplicate names, invalid assignments, and foreign-origin writes are rejected', async ({ request, baseURL }) => {
  await signIn(request, baseURL!);
  const duplicate = await request.post(`/api/pos/categories?businessLineId=${fixtures.kedai.id}`, { headers: { Origin: baseURL! }, data: { name: '  MAKANAN  ' } });
  expect(duplicate.status()).toBe(409);
  const blank = await request.post(`/api/pos/categories?businessLineId=${fixtures.kedai.id}`, { headers: { Origin: baseURL! }, data: { name: '   ' } });
  expect(blank.status()).toBe(400);
  const missing = await request.patch(`/api/pos/products/${fixtures.product.id}`, { headers: { Origin: baseURL! }, data: { categoryId: randomUUID() } });
  expect(missing.status()).toBe(404);
  expect((await request.patch(`/api/pos/products/${fixtures.product.id}`, { headers: { Origin: baseURL! }, data: { categoryId: 'not-uuid' } })).status()).toBe(400);
  expect((await request.patch(`/api/pos/products/${fixtures.product.id}`, { headers: { Origin: baseURL! }, data: { price: -1, categoryId: null } })).status()).toBe(400);
  expect((await request.post(`/api/pos/categories?businessLineId=${fixtures.kedai.id}`, { headers: { Origin: 'https://foreign.example' }, data: { name: 'Forbidden category' } })).status()).toBe(403);
});

test('cashier can read/filter categories but cannot manage them or product assignments', async ({ request, baseURL }) => {
  await signIn(request, baseURL!, true);
  expect((await request.get(`/api/pos/categories?businessLineId=${fixtures.kedai.id}`)).status()).toBe(200);
  expect((await request.post(`/api/pos/categories?businessLineId=${fixtures.kedai.id}`, { headers: { Origin: baseURL! }, data: { name: 'Denied' } })).status()).toBe(403);
  expect((await request.patch(`/api/pos/categories/${fixtures.categories.snack.id}`, { headers: { Origin: baseURL! }, data: { name: 'Denied' } })).status()).toBe(403);
  expect((await request.delete(`/api/pos/categories/${fixtures.categories.snack.id}`, { headers: { Origin: baseURL! } })).status()).toBe(403);
  expect((await request.patch(`/api/pos/products/${fixtures.product.id}`, { headers: { Origin: baseURL! }, data: { categoryId: null } })).status()).toBe(403);
});

test('assigned admin can manage categories and product assignments', async ({ request, baseURL }) => {
  expect((await request.post('/api/session', { headers: { Origin: baseURL! }, data: { email: fixtures.admin.email, password: fixtures.admin.password } })).status()).toBe(200);
  const category = await createCategory(request, baseURL!);
  const assignment = await request.patch(`/api/pos/products/${fixtures.uncategorizedProduct.id}`, { headers: { Origin: baseURL! }, data: { categoryId: category.id.toUpperCase() } });
  expect(assignment.status()).toBe(200);
  expect((await assignment.json()).categoryId).toBe(category.id);
  const count = await request.get(`/api/pos/categories/${category.id.toUpperCase()}`);
  expect((await count.json()).productCount).toBe(1);
  expect((await request.delete(`/api/pos/categories/${category.id.toUpperCase()}`, { headers: { Origin: baseURL! } })).status()).toBe(409);
  expect((await request.patch(`/api/pos/products/${fixtures.uncategorizedProduct.id}`, { headers: { Origin: baseURL! }, data: { categoryId: null } })).status()).toBe(200);
  expect((await request.delete(`/api/pos/categories/${category.id}`, { headers: { Origin: baseURL! } })).status()).toBe(204);
});

test('concurrent assignment and archive never leave a product pointing at an archived category', async ({ request, baseURL }) => {
  await signIn(request, baseURL!);
  const category = await createCategory(request, baseURL!);
  const [assignment, archive] = await Promise.all([
    request.patch(`/api/pos/products/${fixtures.uncategorizedProduct.id}`, { headers: { Origin: baseURL! }, data: { categoryId: category.id } }),
    request.delete(`/api/pos/categories/${category.id}`, { headers: { Origin: baseURL! } }),
  ]);
  expect(assignment.status() === 200 && archive.status() === 204).toBe(false);
  expect([200, 409]).toContain(assignment.status());
  expect([204, 409]).toContain(archive.status());
  const product = await findProduct(request, fixtures.uncategorizedProduct.id);
  const currentCategory = await (await request.get(`/api/pos/categories/${category.id}`)).json();
  if (product.categoryId === category.id) expect(currentCategory.active).toBe(true);
  if (!currentCategory.active) expect(product.categoryId).not.toBe(category.id);
  await request.patch(`/api/pos/products/${fixtures.uncategorizedProduct.id}`, { headers: { Origin: baseURL! }, data: { categoryId: null } });
  await request.delete(`/api/pos/categories/${category.id}`, { headers: { Origin: baseURL! } });
});
