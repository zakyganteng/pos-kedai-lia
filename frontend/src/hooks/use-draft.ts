'use client';

import { useCallback, useMemo } from 'react';
import {
  clearStored,
  getStoredJson,
  setStoredJson,
  storageKeys,
  useStoredJson,
  type Workspace,
} from './use-storage';

export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 1000;
/** CreateSaleRequest.items maxItems in the API contract. */
export const MAX_DISTINCT_ITEMS = 100;

export type DraftItem = {
  itemType: 'product' | 'service';
  itemId: string;
  /** Snapshot for display only. The server prices the sale. */
  name: string;
  unitPrice: number;
  quantity: number;
  stockTracked: boolean;
};

export type Draft = {
  items: DraftItem[];
  customerId: string | null;
  customerName: string | null;
};

export const EMPTY_DRAFT: Draft = { items: [], customerId: null, customerName: null };

function clampQuantity(value: number): number {
  if (!Number.isFinite(value)) return MIN_QUANTITY;
  return Math.min(MAX_QUANTITY, Math.max(MIN_QUANTITY, Math.trunc(value)));
}

export function parseDraft(value: unknown): Draft {
  if (typeof value !== 'object' || value === null) return EMPTY_DRAFT;
  const raw = value as Partial<Draft>;
  const source = Array.isArray(raw.items) ? raw.items : [];
  const items: DraftItem[] = [];
  for (const entry of source) {
    if (typeof entry !== 'object' || entry === null) continue;
    const item = entry as Partial<DraftItem>;
    if (typeof item.itemId !== 'string' || typeof item.name !== 'string') continue;
    if (item.itemType !== 'product' && item.itemType !== 'service') continue;
    if (typeof item.unitPrice !== 'number' || !Number.isFinite(item.unitPrice)) continue;
    if (items.some((existing) => existing.itemId === item.itemId)) continue;
    items.push({
      itemType: item.itemType,
      itemId: item.itemId,
      name: item.name,
      unitPrice: item.unitPrice,
      quantity: clampQuantity(typeof item.quantity === 'number' ? item.quantity : MIN_QUANTITY),
      stockTracked: item.stockTracked === true,
    });
    if (items.length >= MAX_DISTINCT_ITEMS) break;
  }
  return {
    items,
    customerId: typeof raw.customerId === 'string' ? raw.customerId : null,
    customerName: typeof raw.customerName === 'string' ? raw.customerName : null,
  };
}

function isBlank(draft: Draft): boolean {
  return draft.items.length === 0 && draft.customerId === null;
}

export type DraftApi = {
  draft: Draft;
  total: number;
  itemCount: number;
  isEmpty: boolean;
  isFull: boolean;
  quantityOf: (itemId: string) => number;
  addItem: (item: Omit<DraftItem, 'quantity'>, quantity?: number) => void;
  setQuantity: (itemId: string, quantity: number) => void;
  removeItem: (itemId: string) => void;
  setCustomer: (customerId: string | null, customerName: string | null) => void;
  clear: () => void;
};

/**
 * One draft order per user and business line, held in sessionStorage so a
 * reload does not lose a half built order.
 *
 * The draft is read straight from the store rather than copied into component
 * state, so switching line or user swaps the whole workspace atomically and no
 * pending write can land under the newly selected key.
 */
export function useDraft(workspace: Workspace): DraftApi {
  const key = storageKeys.draft(workspace);
  const draft = useStoredJson<Draft>(key, parseDraft);

  const update = useCallback(
    (change: (current: Draft) => Draft) => {
      // Re-read at write time: the store, not a render snapshot, is the truth.
      const next = change(getStoredJson(key, parseDraft));
      if (isBlank(next)) clearStored(key);
      else setStoredJson(key, next);
    },
    [key],
  );

  const addItem = useCallback<DraftApi['addItem']>(
    (item, quantity = 1) => {
      update((current) => {
        const index = current.items.findIndex((line) => line.itemId === item.itemId);
        if (index === -1) {
          if (current.items.length >= MAX_DISTINCT_ITEMS) return current;
          return {
            ...current,
            items: [
              ...current.items,
              { ...item, quantity: clampQuantity(quantity) },
            ],
          };
        }
        // Repeating an itemId is rejected by the API, so quantities combine.
        const items = current.items.slice();
        items[index] = { ...items[index], quantity: clampQuantity(items[index].quantity + quantity) };
        return { ...current, items };
      });
    },
    [update],
  );

  const setQuantity = useCallback<DraftApi['setQuantity']>(
    (itemId, quantity) => {
      update((current) => ({
        ...current,
        items: current.items.map((line) =>
          line.itemId === itemId ? { ...line, quantity: clampQuantity(quantity) } : line,
        ),
      }));
    },
    [update],
  );

  const removeItem = useCallback<DraftApi['removeItem']>(
    (itemId) => {
      update((current) => ({
        ...current,
        items: current.items.filter((line) => line.itemId !== itemId),
      }));
    },
    [update],
  );

  const setCustomer = useCallback<DraftApi['setCustomer']>(
    (customerId, customerName) => {
      update((current) => ({ ...current, customerId, customerName }));
    },
    [update],
  );

  const clear = useCallback(() => clearStored(key), [key]);

  const total = useMemo(
    () => draft.items.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
    [draft.items],
  );
  const itemCount = useMemo(
    () => draft.items.reduce((sum, line) => sum + line.quantity, 0),
    [draft.items],
  );
  const quantityOf = useCallback(
    (itemId: string) => draft.items.find((line) => line.itemId === itemId)?.quantity ?? 0,
    [draft.items],
  );

  return {
    draft,
    total,
    itemCount,
    isEmpty: draft.items.length === 0,
    isFull: draft.items.length >= MAX_DISTINCT_ITEMS,
    quantityOf,
    addItem,
    setQuantity,
    removeItem,
    setCustomer,
    clear,
  };
}
