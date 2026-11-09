'use client';

import { createContext, useContext } from 'react';
import type { BusinessLine, CurrentUser } from '@/lib/types';
import type { Workspace } from './use-storage';

export type SessionValue = {
  user: CurrentUser;
  /** Business lines this user is assigned to, never a catalogue of all lines. */
  lines: BusinessLine[];
  /** The line every screen is scoped to. */
  line: BusinessLine;
  /** Identity plus line. All per counter storage is namespaced by this pair. */
  workspace: Workspace;
  requestLineChange: (lineId: string) => void;
  logout: () => void;
  loggingOut: boolean;
  /** Called when a request returns 401 so the shell can send the user to login. */
  onSessionExpired: () => void;
};

export const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error('useSession must be used inside the POS shell');
  }
  return value;
}

export function isSalonLine(line: BusinessLine): boolean {
  return line.type === 'salon';
}
