#!/usr/bin/env node
// Browser checks against a disposable database and the real Go API.
// Requires the project's Docker PostgreSQL/backend stack and Go on the host.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway } from '../../tests/support/gateway.mjs';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = resolve(frontend, '..');
const work = await mkdtemp(join(tmpdir(), 'lia-frontend-e2e-'));
const dbName = `lia_frontend_e2e_${process.pid}_${randomBytes(3).toString('hex')}`;
const apiPort = Number(process.env.E2E_API_PORT ?? 18181);
const webPort = Number(process.env.E2E_WEB_PORT ?? 3100);
const gatewayPort = Number(process.env.E2E_GATEWAY_PORT ?? 19191);
const secret = randomBytes(32).toString('hex');
const gatewayKey = randomBytes(24).toString('hex');
const children = [];
let databaseCreated = false;
let gateway;
let apiLog = '';
let webLog = '';
let cleanupPromise;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: project, encoding: 'utf8', timeout: 120_000, ...options });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args[0]} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout.trim();
}
function compose(args) { return run('docker', ['compose', ...args]); }
function launch(command, args, env, log) {
  const child = spawn(command, args, { cwd: frontend, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  children.push(child);
  child.stdout.on('data', chunk => log(chunk.toString()));
  child.stderr.on('data', chunk => log(chunk.toString()));
  return child;
}
async function ready(url, child, logs, accepted = [200]) {
  // Bounded HTTP readiness checks, not subagent/session polling.
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(`Server exited before readiness: ${logs().slice(-4000)}`);
    try { if (accepted.includes((await fetch(url, { signal: AbortSignal.timeout(1500) })).status)) return; } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become ready at ${url}: ${logs().slice(-4000)}`);
}
async function stop(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }, 5000);
  timer.unref();
  await exited;
  clearTimeout(timer);
}
async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    for (const child of children.reverse()) await stop(child);
    if (gateway) await gateway.close();
    if (databaseCreated) {
      compose(['exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE "${dbName}" WITH (FORCE)`]);
      console.log(`Dropped disposable database ${dbName}`);
    }
    await rm(work, { recursive: true, force: true });
  })();
  return cleanupPromise;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => cleanup().finally(() => process.exit(130)));

try {
  // Capture runtime connection data internally; never print database credentials.
  const dbUrl = new URL(compose(['exec', '-T', 'backend', 'printenv', 'DATABASE_URL']));
  const dbBinding = compose(['port', 'db', '5432']);
  dbUrl.hostname = '127.0.0.1';
  dbUrl.port = dbBinding.slice(dbBinding.lastIndexOf(':') + 1);
  dbUrl.pathname = `/${dbName}`;
  compose(['exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE "${dbName}"`]);
  databaseCreated = true;
  console.log(`Created disposable database ${dbName}`);
  const binary = join(work, 'pos');
  run('go', ['build', '-o', binary, './cmd/pos'], { cwd: resolve(project, 'backend') });
  gateway = await startGateway({ port: gatewayPort, apiKey: gatewayKey, notificationKey: 'unused-e2e-boundary' });
  const env = {
    DATABASE_URL: dbUrl.toString(), HTTP_ADDR: `127.0.0.1:${apiPort}`,
    APP_ENV: 'development', SESSION_TTL: '30m', BUSINESS_TIMEZONE: 'Asia/Jakarta',
    PAYMENT_PROVIDER: 'mock', PAYMENT_BASE_URL: `http://127.0.0.1:${gatewayPort}/mock-gateway/v1`,
    PAYMENT_API_KEY: gatewayKey, PAYMENT_WEBHOOK_SECRET: secret,
    NOTIFICATION_PROVIDER: 'disabled',
  };
  run(binary, ['migrate'], { env: { ...process.env, ...env } });
  const api = launch(binary, ['serve'], env, chunk => { apiLog += chunk; });
  const apiUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  await ready(`${apiUrl}/health/ready`, api, () => apiLog);
  async function request(path, body, token, headers = {}) {
    const response = await fetch(`${apiUrl}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`Fixture setup ${path}: ${response.status} ${data.error?.code}`);
    return data;
  }
  const email = 'owner@owner.com';
  const password = 'owner-password-123';
  const session = await request('/auth/login', { email, password });
  const token = session.accessToken;
  const kedai = session.user.businessLines.find(line => line.type === 'food_beverage');
  const salon = session.user.businessLines.find(line => line.type === 'salon');
  const categoryPage = await request(`/categories?businessLineId=${kedai.id}&active=true&limit=100`, undefined, token);
  const categories = {
    makanan: categoryPage.data.find(category => category.name === 'Makanan'),
    minuman: categoryPage.data.find(category => category.name === 'Minuman'),
    snack: categoryPage.data.find(category => category.name === 'Snack'),
  };
  if (Object.values(categories).some(category => !category)) throw new Error('Default kedai categories missing after migration.');
  const tracked = await request(`/products?businessLineId=${kedai.id}`, { sku: 'E2E-TRACKED', name: '[UJI E2E] Produk stok terbatas', unit: 'porsi', price: 15000, stockTracked: true, categoryId: categories.makanan.id }, token);
  await request(`/inventory/movements?businessLineId=${kedai.id}`, { productId: tracked.id, type: 'receive', quantityDelta: 10, reason: '[UJI E2E] stok pengujian' }, token, { 'X-Idempotency-Key': randomUUID() });
  const product = await request(`/products?businessLineId=${kedai.id}`, { sku: 'E2E-ITEM', name: '[UJI E2E] Produk kasir', unit: 'gelas', price: 10000, stockTracked: false, categoryId: categories.makanan.id }, token);
  const longProduct = await request(`/products?businessLineId=${kedai.id}`, { sku: 'E2E-LONG', name: '[UJI E2E] Produk dengan nama panjang untuk menguji pembungkusan teks pada layar kasir berukuran kecil', unit: 'porsi', price: 20000, stockTracked: false, categoryId: categories.snack.id }, token);
  for (let index = 1; index <= 18; index++) {
    await request(`/products?businessLineId=${kedai.id}`, { sku: `E2E-PAGE-${index}`, name: `[UJI E2E] Item halaman ${String(index).padStart(2, '0')}`, unit: 'buah', price: 1000, stockTracked: false, categoryId: categories.minuman.id }, token);
  }
  const uncategorizedProduct = await request(`/products?businessLineId=${kedai.id}`, { sku: 'E2E-UNCATEGORIZED', name: '[UJI E2E] Produk tanpa kategori', unit: 'item', price: 6000, stockTracked: false }, token);
  const service = await request(`/services?businessLineId=${salon.id}`, { name: '[UJI E2E] Layanan salon', price: 25000, durationMinutes: 30 }, token);
  const customer = await request(`/customers?businessLineId=${kedai.id}`, { name: '[UJI E2E] Pelanggan kasir' }, token);
  const staff = await request(`/staff?businessLineId=${salon.id}`, { name: '[UJI E2E] Staf salon' }, token);
  const cashierPassword = randomBytes(18).toString('base64url');
  const cashier = await request('/users', { name: '[UJI E2E] Kasir', email: 'cashier-e2e@example.test', password: cashierPassword, role: 'cashier', businessLineIds: [kedai.id] }, token);
  const adminPassword = randomBytes(18).toString('base64url');
  const admin = await request('/users', { name: '[UJI E2E] Admin', email: 'admin-e2e@example.test', password: adminPassword, role: 'admin', businessLineIds: [kedai.id] }, token);
  const fixturePath = join(work, 'fixtures.json');
  await writeFile(fixturePath, JSON.stringify({ apiUrl, gatewayUrl: `http://127.0.0.1:${gatewayPort}`, secret, email, password, kedai, salon, categories, uncategorizedProduct, tracked, product, longProduct, service, customer, staff, cashier: { ...cashier, password: cashierPassword }, admin: { ...admin, password: adminPassword } }), { mode: 0o600 });
  const web = launch('npm', ['run', 'dev', '--', '--port', String(webPort)], { POS_API_URL: apiUrl }, chunk => { webLog += chunk; });
  const url = `http://127.0.0.1:${webPort}`;
  await ready(`${url}/api/session`, web, () => webLog, [401]);
  const test = spawn(resolve(frontend, 'node_modules/.bin/playwright'), ['test', ...process.argv.slice(2)], {
    cwd: frontend, stdio: 'inherit', env: { ...process.env, E2E_URL: url, E2E_FIXTURE_PATH: fixturePath }, detached: true,
  });
  children.push(test);
  const code = await new Promise((resolve, reject) => { test.once('exit', code => resolve(code ?? 1)); test.once('error', reject); });
  process.exitCode = code;
  if (code) console.error(`Frontend log (tail):\n${webLog.slice(-4000)}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  try { await cleanup(); } catch (error) { console.error(`Cleanup failed: ${error.message}`); process.exitCode = 1; }
}
