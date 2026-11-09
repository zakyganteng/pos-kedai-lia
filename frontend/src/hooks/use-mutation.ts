'use client';

import { useCallback, useRef, useState } from 'react';
import { describeFailure, isUnauthorized } from './use-api-error';

export type MutationFailure = {
  status: number;
  code: string;
  message: string;
  fieldErrors: { field: string; message: string }[];
  /**
   * The write may already have been applied. A dropped connection or a 5xx
   * can follow a committed change, so the screen must not report the old
   * state as still current; it has to go back and read.
   */
  uncertain: boolean;
};

export type MutationResult = {
  /** True while the write under this key is in flight. */
  isPending: (key: string) => boolean;
  /** True while any write is in flight. */
  busy: boolean;
  /** The last failure for this key, cleared when the key is retried. */
  failureOf: (key: string) => MutationFailure | null;
  clear: (key: string) => void;
  /**
   * Runs one write and reports whether the *server* confirmed it.
   *
   * Resolving means the backend returned a success status. Anything else,
   * from a 409 refusing to archive a category that still holds products to a
   * lost connection, resolves to false. The caller must then leave the screen
   * showing the state the server last confirmed, and for an uncertain failure
   * must say so rather than claim nothing changed.
   */
  run: (key: string, work: () => Promise<void>) => Promise<boolean>;
};

const NO_FAILURES: Readonly<Record<string, MutationFailure>> = {};

/**
 * Tracks pending state and the last error for keyed writes.
 *
 * Keys are per row (`rename:<id>`), so one failing row never blanks another
 * row's message and two rows can report different problems at once.
 */
export function useMutation(options?: { onUnauthorized?: () => void }): MutationResult {
  const onUnauthorized = options?.onUnauthorized;
  const [pending, setPending] = useState<readonly string[]>([]);
  const [failures, setFailures] =
    useState<Readonly<Record<string, MutationFailure>>>(NO_FAILURES);

  // State updates are not readable synchronously, so the single flight guard
  // reads a ref: two taps on one button must not send two writes.
  const inFlight = useRef<Set<string>>(new Set());

  const clear = useCallback((key: string) => {
    setFailures((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const run = useCallback(
    async (key: string, work: () => Promise<void>): Promise<boolean> => {
      if (inFlight.current.has(key)) return false;
      inFlight.current.add(key);
      setPending((current) => (current.includes(key) ? current : [...current, key]));
      clear(key);

      try {
        await work();
        return true;
      } catch (caught: unknown) {
        const failure = describeFailure(caught);
        setFailures((current) => ({
          ...current,
          [key]: {
            status: failure.status,
            code: failure.code,
            message: failure.message,
            fieldErrors: failure.fieldErrors,
            // Classification lives in lib/api so the screens cannot drift
            // from the client's own view of what a lost write means.
            uncertain: failure.kind === 'uncertain',
          },
        }));
        if (isUnauthorized(caught)) onUnauthorized?.();
        return false;
      } finally {
        inFlight.current.delete(key);
        setPending((current) => current.filter((entry) => entry !== key));
      }
    },
    [clear, onUnauthorized],
  );

  const isPending = useCallback((key: string) => pending.includes(key), [pending]);
  const failureOf = useCallback((key: string) => failures[key] ?? null, [failures]);

  return { isPending, busy: pending.length > 0, failureOf, clear, run };
}
