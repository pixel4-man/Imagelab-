import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { AdInsertPosition, AdStatus, AdType } from '../types/ads';

export interface SelectedPlacementTarget {
  pageRoute: string;
  slotId: string;
  selector: string;
  elementInfo: string;
  suggestedName: string;
  position: AdInsertPosition;
  element: HTMLElement | null;
}

export interface PendingAdFormDraft {
  editingAdId: string | null;
  adType: AdType;
  width: string;
  height: string;
  status: AdStatus;
  priority: number;
  scriptCode: string;
  destinationUrl: string;
  returnTo: string;
}

interface PlacementSelectorContextValue {
  isPrivilegedAdmin: boolean;
  selectionMode: boolean;
  selectedTarget: SelectedPlacementTarget | null;
  enterSelectionMode: () => void;
  exitSelectionMode: () => void;
  setSelectedTarget: (target: SelectedPlacementTarget | null) => void;
  clearSelectedTarget: () => void;
}

const STORAGE_SELECTION_KEY = 'imagelab_visual_placement_mode_v1';
const STORAGE_PENDING_AD_DRAFT_KEY = 'imagelab_pending_ad_draft_v1';

export function savePendingAdDraft(draft: PendingAdFormDraft): void {
  try {
    sessionStorage.setItem(STORAGE_PENDING_AD_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Ignore storage quota or private mode restrictions
  }
}

export function readPendingAdDraft(): PendingAdFormDraft | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_PENDING_AD_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingAdFormDraft>;
    return {
      editingAdId: typeof parsed.editingAdId === 'string' ? parsed.editingAdId : null,
      adType: parsed.adType || 'responsive_banner',
      width: typeof parsed.width === 'string' ? parsed.width : 'auto',
      height: typeof parsed.height === 'string' ? parsed.height : 'auto',
      status: parsed.status === 'disabled' ? 'disabled' : 'active',
      priority: typeof parsed.priority === 'number' ? parsed.priority : 10,
      scriptCode: typeof parsed.scriptCode === 'string' ? parsed.scriptCode : '',
      destinationUrl: typeof parsed.destinationUrl === 'string' ? parsed.destinationUrl : '',
      returnTo:
        typeof parsed.returnTo === 'string' && parsed.returnTo.startsWith('/')
          ? parsed.returnTo
          : '/admin/ads',
    };
  } catch {
    return null;
  }
}

export function clearPendingAdDraft(): void {
  try {
    sessionStorage.removeItem(STORAGE_PENDING_AD_DRAFT_KEY);
  } catch {
    // Ignore storage errors
  }
}

const PlacementSelectorContext = createContext<PlacementSelectorContextValue | null>(null);

export function PlacementSelectorProvider({ children }: { children: React.ReactNode }) {
  const { authReady, firebaseUser, userProfile } = useAuth();

  const isPrivilegedAdmin =
    Boolean(authReady && firebaseUser && userProfile) &&
    userProfile?.accountStatus === 'active' &&
    (userProfile?.role === 'admin' || userProfile?.role === 'super_admin');

  const [selectionMode, setSelectionMode] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(STORAGE_SELECTION_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [selectedTarget, setSelectedTarget] = useState<SelectedPlacementTarget | null>(null);

  // Immediately revoke selection mode if user logs out or lacks verified admin role
  useEffect(() => {
    if (!authReady) return;
    if (!isPrivilegedAdmin && selectionMode) {
      setSelectionMode(false);
      setSelectedTarget(null);
      try {
        sessionStorage.removeItem(STORAGE_SELECTION_KEY);
      } catch {
        // Ignore storage errors
      }
    }
  }, [authReady, isPrivilegedAdmin, selectionMode]);

  const enterSelectionMode = useCallback(() => {
    if (!isPrivilegedAdmin) return;
    setSelectedTarget(null);
    setSelectionMode(true);
    try {
      sessionStorage.setItem(STORAGE_SELECTION_KEY, '1');
    } catch {
      // Ignore storage errors
    }
  }, [isPrivilegedAdmin]);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedTarget(null);
    try {
      sessionStorage.removeItem(STORAGE_SELECTION_KEY);
    } catch {
      // Ignore storage errors
    }
  }, []);

  const clearSelectedTarget = useCallback(() => {
    setSelectedTarget(null);
  }, []);

  return (
    <PlacementSelectorContext.Provider
      value={{
        isPrivilegedAdmin,
        selectionMode: Boolean(isPrivilegedAdmin && selectionMode),
        selectedTarget,
        enterSelectionMode,
        exitSelectionMode,
        setSelectedTarget,
        clearSelectedTarget,
      }}
    >
      {children}
    </PlacementSelectorContext.Provider>
  );
}

export function usePlacementSelector() {
  const ctx = useContext(PlacementSelectorContext);
  if (!ctx) {
    throw new Error('usePlacementSelector must be used inside PlacementSelectorProvider');
  }
  return ctx;
}
