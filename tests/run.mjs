#!/usr/bin/env node
/** Disposable real-PostgreSQL / real-Go-API verification. No application mocks. */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { startGateway } from './support/gateway.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const backend = resolve(here, '../backend');
// Administrative access is used ONLY to create/drop this runner's unique databases.
const adminUrl = process.env.QA_PG_ADMIN_URL || 'postgres:///postgres';
const port = Number(process.env.QA_API_PORT || 18081);
const gatewayPort = Number(process.env.QA_GATEWAY_PORT || 19091);
// Default owner created by the first migration on an empty users table.
const ownerEmail = 'owner@owner.com';
const ownerPassword = 'owner-password-123';
const secret = randomBytes(32).toString('hex');
const gatewayKey = randomBytes(24).toString('hex');
const notificationKey = randomBytes(24).toString('base64url').slice(0, 32);
const notificationDestination = '+628119999QA00';
// Explicit non-default template: proves the configured value is what gets rendered,
// using only the server-side placeholders the backend documents as supported.
const notificationTemplate = 'QA alert {{saleId}} / {{total}} / {{businessLineId}} :: end';
const work = await mkdtemp(join(tmpdir(), 'lia-pos-qa-'));
const binary = join(work, 'pos');
const databases = [];
const servers = [];
let suite;
let gateway;
let apiLog = '';
let cleaning;

function command(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: 'utf8', timeout: 120_000, ...options });
  if (result.error || result.status !== 0) {
    throw new Error(`${program} ${args[0] || ''} failed: ${result.error?.message || result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function stop(child, grace) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exit = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), grace);
  timer.unref();
  await exit;
  clearTimeout(timer);
}

async function cleanup() {
  if (cleaning) return cleaning;
  cleaning = (async () => {
    await stop(suite, 3_000);
    for (const api of servers) await stop(api, 5_000);
    if (gateway) await gateway.close();
    for (const database of databases) {
      command('psql', ['-X', '-v', 'ON_ERROR_STOP=1', adminUrl, '-c', `DROP DATABASE "${database}" WITH (FORCE)`]);
      console.log(`# Dropped disposable database ${database}`);
    }
    // Persist the real server log only when explicitly requested. Never include generated secrets.
    if (process.env.QA_LOG_PATH) {
      const sanitized = [secret, gatewayKey, notificationKey].reduce((log, value) => log.replaceAll(value, '[REDACTED]'), apiLog);
      await writeFile(resolve(process.env.QA_LOG_PATH), sanitized);
    }
    await rm(work, { recursive: true, force: true });
  })();
  return cleaning;
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { cleanup().finally(() => process.exit(130)); });
}

/** Create an isolated database, migrate it (creating the default owner) and start the real API on its own port. */
async function startApi({ suffix, httpPort, notification }) {
  const database = `lia_pos_qa_${process.pid}${suffix}`;
  const dbUrl = new URL(adminUrl);
  dbUrl.pathname = `/${database}`;
  command('psql', ['-X', '-v', 'ON_ERROR_STOP=1', adminUrl, '-c', `CREATE DATABASE "${database}"`]);
  databases.push(database);
  console.log(`# Created disposable database ${database}; API http://127.0.0.1:${httpPort}`);
  const env = {
    ...process.env,
    DATABASE_URL: dbUrl.toString(),
    HTTP_ADDR: `127.0.0.1:${httpPort}`,
    APP_ENV: 'development',
    SESSION_TTL: '30m',
    BUSINESS_TIMEZONE: 'Asia/Jakarta',
    PAYMENT_PROVIDER: 'mock',
    PAYMENT_BASE_URL: `http://127.0.0.1:${gatewayPort}/mock-gateway/v1`,
    PAYMENT_API_KEY: gatewayKey,
    PAYMENT_WEBHOOK_SECRET: secret,
    NOTIFICATION_PROVIDER: notification ? 'http' : 'disabled',
    NOTIFICATION_BASE_URL: notification ? `http://127.0.0.1:${gatewayPort}/notify/v1` : '',
    NOTIFICATION_API_KEY: notification ? notificationKey : '',
    NOTIFICATION_DESTINATION: notification ? notificationDestination : '',
    ...(notification ? { NOTIFICATION_TEMPLATE: notificationTemplate } : {}),
  };
  command(binary, ['migrate'], { cwd: backend, env });
  const api = spawn(binary, ['serve'], { cwd: backend, env, stdio: ['ignore', 'pipe', 'pipe'] });
  servers.push(api);
  api.stdout.on('data', chunk => { apiLog += chunk; });
  api.stderr.on('data', chunk => { apiLog += chunk; });
  api.on('error', error => { apiLog += error.message; });
  // Bounded actual HTTP readiness, not process/agent status polling.
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (api.exitCode !== null) throw new Error(`API exited during startup: ${apiLog}`);
    try {
      const response = await fetch(`http://127.0.0.1:${httpPort}/api/v1/health/ready`, { signal: AbortSignal.timeout(500) });
      if (response.ok) { ready = true; break; }
    } catch { /* connection refused until HTTP server listens */ }
    await delay(100);
  }
  if (!ready) throw new Error(`API not ready within 10 seconds: ${apiLog}`);
  return { env, database, httpPort };
}

/** Run one black-box file against one live API; never import application code. */
async function runSuite(file, { env, database, httpPort }, extra = {}) {
  suite = spawn(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', join(here, file)], {
    cwd: here,
    stdio: 'inherit',
    env: {
      ...env,
      QA_API_URL: `http://127.0.0.1:${httpPort}/api/v1`,
      QA_GATEWAY_URL: `http://127.0.0.1:${gatewayPort}`,
      QA_OWNER_EMAIL: ownerEmail,
      QA_OWNER_PASSWORD: ownerPassword,
      QA_WEBHOOK_SECRET: secret,
      QA_ISOLATED_DATABASE: database,
      ...extra,
    },
  });
  const child = suite;
  return new Promise((resolve, reject) => {
    child.once('exit', code => resolve(code ?? 1));
    child.once('error', reject);
  });
}

try {
  command('go', ['build', '-o', binary, './cmd/pos'], { cwd: backend });
  gateway = await startGateway({ port: gatewayPort, apiKey: gatewayKey, notificationKey });
  // Phase 1: notifications deliberately disabled, verifying observable undelivered state.
  const main = await startApi({ suffix: '', httpPort: port });
  let code = await runSuite('api.test.mjs', main);
  // Phase 2: separate database/API bound to the deterministic notification HTTP boundary.
  // A separate database keeps the disabled-provider worker from claiming these outbox jobs.
  const delivery = await startApi({ suffix: '2', httpPort: port + 1, notification: true });
  const deliveryCode = await runSuite('notifications.test.mjs', delivery, {
    QA_NOTIFICATION_DESTINATION: notificationDestination,
    QA_NOTIFICATION_TEMPLATE: notificationTemplate,
    QA_POS_BINARY: binary,
    QA_BACKEND_DIR: backend,
  });
  process.exitCode = code || deliveryCode;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  try { await cleanup(); } catch (error) { console.error(`Cleanup failed: ${error.message}`); process.exitCode = 1; }
}
