import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { AdInsertPosition } from '../types/ads';

export interface SelectedPlacementTarget {
  pageRoute: string;
  slotId: string;
  selector: string;
  elementInfo: string;
  suggestedName: string;
  position: AdInsertPosition;
  element: HTMLElement | null;
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
