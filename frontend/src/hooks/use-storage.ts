'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

/**
 * sessionStorage as a subscribable store.
 *
 * Nothing secret is kept here: only the selected business line, in progress
 * order drafts, and the frozen checkout attempt needed to retry a write whose
 * outcome is unknown. The server re-validates all of it.
 *
 * Every per workspace key carries the user id as well as the business line id.
 * The backend scopes idempotency by user and line, so a key left behind by one
 * cashier must never be replayed by the next person who signs in at the same
 * counter: that would buy a second sale with a key the backend considers new.
 */

const PREFIX = 'lia-pos.';

export type Workspace = {
  userId: string;
  lineId: string;
};

export const storageKeys = {
  selectedLine: (userId: string) => `${PREFIX}line.${userId}`,
  draft: (workspace: Workspace) => `${PREFIX}draft.${workspace.userId}.${workspace.lineId}`,
  checkout: (workspace: Workspace) => `${PREFIX}checkout.${workspace.userId}.${workspace.lineId}`,
  pendingSales: (workspace: Workspace) => `${PREFIX}pending.${workspace.userId}.${workspace.lineId}`,
};

const listeners = new Map<string, Set<() => void>>();
const cache = new Map<string, string | null>();
let crossTabBound = false;

function store(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function emit(key: string): void {
  const set = listeners.get(key);
  if (set === undefined) return;
  for (const listener of set) listener();
}

function emitAll(): void {
  for (const key of Array.from(listeners.keys())) emit(key);
}

function bindCrossTab(): void {
  if (crossTabBound || typeof window === 'undefined') return;
  crossTabBound = true;
  // A duplicated tab inherits sessionStorage; keep the cache honest if the
  // other copy writes.
  window.addEventListener('storage', () => {
    cache.clear();
    emitAll();
  });
}

export function getStoredString(key: string): string | null {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const value = store()?.getItem(key) ?? null;
  cache.set(key, value);
  return value;
}

export function setStoredString(key: string, value: string | null): void {
  cache.set(key, value);
  const target = store();
  try {
    if (value === null) target?.removeItem(key);
    else target?.setItem(key, value);
  } catch {
    // Private mode or quota exhaustion. The in memory cache still serves this
    // tab, so an order in progress is not lost mid shift.
  }
  emit(key);
}

export function subscribeStored(key: string, listener: () => void): () => void {
  bindCrossTab();
  let set = listeners.get(key);
  if (set === undefined) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}

/**
 * Removes routine per counter state: drafts, the selected line, and the list
 * of watched pending sales.
 *
 * A frozen checkout attempt is deliberately left alone. It is the only record
 * of an idempotency key whose outcome is still unknown, and it is namespaced
 * by user id, so the same cashier can sign back in and resolve it while no
 * other user can ever see or replay it.
 */
export function clearRoutineStored(): void {
  const target = store();
  if (target !== null) {
    const doomed: string[] = [];
    for (let index = 0; index < target.length; index += 1) {
      const key = target.key(index);
      if (key === null || !key.startsWith(PREFIX)) continue;
      if (key.startsWith(`${PREFIX}checkout.`)) continue;
      doomed.push(key);
    }
    for (const key of doomed) {
      try {
        target.removeItem(key);
      } catch {
        /* ignore */
      }
      cache.delete(key);
    }
  }
  emitAll();
}

/** Reports whether any unresolved checkout attempt is still stored. */
export function hasFrozenAttempt(workspace: Workspace): boolean {
  return getStoredString(storageKeys.checkout(workspace)) !== null;
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function getStoredJson<T>(key: string, parse: (value: unknown) => T): T {
  return parse(parseJson(getStoredString(key)));
}

export function setStoredJson(key: string, value: unknown): void {
  setStoredString(key, JSON.stringify(value));
}

export function clearStored(key: string): void {
  setStoredString(key, null);
}

const serverSnapshot = () => null;

/** Subscribes to one key. Returns null during server render and hydration. */
export function useStoredString(key: string): string | null {
  const subscribe = useCallback((listener: () => void) => subscribeStored(key, listener), [key]);
  const snapshot = useCallback(() => getStoredString(key), [key]);
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/**
 * Subscribes to one key and validates it. `parse` must be a stable module
 * level function so the memo holds.
 */
export function useStoredJson<T>(key: string, parse: (value: unknown) => T): T {
  const raw = useStoredString(key);
  return useMemo(() => parse(parseJson(raw)), [raw, parse]);
}
