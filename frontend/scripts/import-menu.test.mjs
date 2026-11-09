import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMenu, planImport, normalizeName } from './import-menu.mjs';

const menu = (rows, heading = 'Daftar Makanan') => `### ${heading}\n| Nama Menu | Harga |\n| --- | --- |\n${rows}`;

test('provided menu parses 22 foods and 21 drinks with the supplied prices', async () => {
  const text = await readFile(new URL('../../data/menu.md', import.meta.url), 'utf8');
  const items = parseMenu(text);
  assert.equal(items.filter(item => item.category === 'food').length, 22);
  assert.equal(items.filter(item => item.category === 'drink').length, 21);
  assert.equal(items.find(item => item.name === 'Ayam lalapan').price, 19000);
  assert.equal(items.find(item => item.name === 'Es teh').price, 4000);
  assert.ok(items.every(item => item.unit === 'item' && !item.stockTracked));
});

test('parser accepts integer rupiah but rejects missing or invented price syntax', () => {
  assert.equal(parseMenu(menu('| Item | 5000 |'))[0].price, 5000);
  for (const price of ['TBD', '-1', '1.5k', '1000000000001']) {
    assert.throws(() => parseMenu(menu(`| Item | ${price} |`)));
  }
});

test('duplicate names and generated SKU collisions are rejected before writes', () => {
  assert.throws(() => parseMenu(menu('| Item | 5k |\n| ITEM | 5k |')), /Duplicate menu name/);
  assert.throws(() => parseMenu(menu('| A B | 5k |\n| A-B | 5k |')), /Duplicate generated SKU/);
});

test('names are normalized only for matching; imported display names remain unchanged', () => {
  assert.equal(normalizeName('  Es   Teh '), 'es teh');
  assert.equal(parseMenu(menu('| Es Teh | 4k |'))[0].name, 'Es Teh');
});

test('reruns preserve existing products including price, status and stock policy', () => {
  const items = parseMenu(menu('| Es Teh | 4k |'));
  const existing = [{ id: 'existing', sku: 'CUSTOM-SKU', name: 'es teh', price: 7000, active: false, stockTracked: true }];
  const original = JSON.stringify(existing);
  const plan = planImport(items, existing);
  assert.equal(plan[0].existing.id, 'existing');
  assert.equal(JSON.stringify(existing), original);
});

test('a SKU assigned to another product and ambiguous existing names stop preflight', () => {
  const items = parseMenu(menu('| Es Teh | 4k |'));
  assert.throws(() => planImport(items, [{ sku: items[0].sku, name: 'Other' }]), /different product/);
  assert.throws(() => planImport(items, [{ name: 'Es teh' }, { name: 'Es Teh' }]), /More than one/);
});
