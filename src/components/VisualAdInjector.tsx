import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AdRecord, VisualPlacementRecord } from '../types/ads';
import {
  ADS_UPDATED_EVENT,
  ActiveAdState,
  SandboxedAdFrame,
  fetchActiveAdState,
  matchesPlacementRoute,
} from './AdSlot';

interface MountedSlotPortal {
  placement: VisualPlacementRecord;
  ads: AdRecord[];
  host: HTMLDivElement;
}

const ADMIN_OR_AUTH_PREFIXES = ['/admin', '/super-admin', '/login', '/signup'];

function isPublicAdRoute(pathname: string): boolean {
  return !ADMIN_OR_AUTH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function findAnchorElement(placement: VisualPlacementRecord): HTMLElement | null {
  if (placement.slotId) {
    const safeSlot =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(placement.slotId)
        : placement.slotId.replace(/"/g, '');
    const bySlot = document.querySelector<HTMLElement>(`[data-ad-slot="${safeSlot}"]`);
    if (bySlot) return bySlot;
  }

  if (placement.selector) {
    try {
      const bySelector = document.querySelector<HTMLElement>(placement.selector);
      if (bySelector) return bySelector;
    } catch {
      // Ignore malformed stored CSS selectors gracefully
    }
  }
  return null;
}

export function VisualAdInjector() {
  const location = useLocation();
  const { authReady, firebaseUser, userProfile } = useAuth();
  const [adState, setAdState] = useState<ActiveAdState>({ placements: [], ads: [] });
  const [mountedPortals, setMountedPortals] = useState<MountedSlotPortal[]>([]);
  const anchorSyncReportedRef = useRef<Set<string>>(new Set());
  const hostsRef = useRef<HTMLDivElement[]>([]);

  const isPrivilegedAdmin =
    Boolean(authReady && firebaseUser && userProfile) &&
    userProfile?.accountStatus === 'active' &&
    (userProfile?.role === 'admin' || userProfile?.role === 'super_admin');

  const reloadState = useCallback(() => {
    fetchActiveAdState().then((next) => {
      setAdState(next);
    });
  }, []);

  useEffect(() => {
    reloadState();
    window.addEventListener(ADS_UPDATED_EVENT, reloadState);
    return () => window.removeEventListener(ADS_UPDATED_EVENT, reloadState);
  }, [reloadState]);

  const reportAnchorStatus = useCallback(
    async (placementId: string, anchorMissing: boolean) => {
      if (!isPrivilegedAdmin) return;
      const cacheKey = `${placementId}:${anchorMissing ? 'missing' : 'ok'}`;
      if (anchorSyncReportedRef.current.has(cacheKey)) return;
      anchorSyncReportedRef.current.add(cacheKey);
      try {
        const token = await firebaseUser?.getIdToken();
        if (!token) return;
        await fetch(`/api/admin/placements/${placementId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ anchorMissing }),
        });
      } catch {
        // Non-blocking anchor status diagnostic sync
      }
    },
    [isPrivilegedAdmin, firebaseUser]
  );

  useEffect(() => {
    const cleanupHosts = () => {
      for (const h of hostsRef.current) {
        try {
          h.remove();
        } catch {
          // Ignore already removed DOM nodes
        }
      }
      hostsRef.current = [];
      setMountedPortals([]);
    };

    cleanupHosts();

    if (!isPublicAdRoute(location.pathname)) {
      return cleanupHosts;
    }

    const matchingPlacements = adState.placements.filter(
      (p) =>
        p.status === 'active' &&
        matchesPlacementRoute(p.pageRoute, location.pathname)
    );

    if (matchingPlacements.length === 0) {
      return cleanupHosts;
    }

    const mountAvailablePortals = (checkMissing: boolean) => {
      // Remove any prior mounted hosts for clean idempotent mount
      for (const h of hostsRef.current) {
        try {
          h.remove();
        } catch {
          // Ignore
        }
      }
      hostsRef.current = [];

      const nextPortals: MountedSlotPortal[] = [];

      for (const placement of matchingPlacements) {
        const adsForPlacement = adState.ads
          .filter((a) => a.status === 'active' && a.placementId === placement.id)
          .sort((a, b) => a.priority - b.priority);

        if (adsForPlacement.length === 0) continue;

        const anchor = findAnchorElement(placement);
        if (!anchor) {
          if (checkMissing && isPrivilegedAdmin && !placement.anchorMissing) {
            void reportAnchorStatus(placement.id, true);
          }
          continue;
        }

        if (checkMissing && isPrivilegedAdmin && placement.anchorMissing) {
          void reportAnchorStatus(placement.id, false);
        }

        const host = document.createElement('div');
        host.setAttribute('data-imagelab-ad-container', placement.id);
        host.className = 'w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 my-5';

        const insertTarget =
          placement.position === 'before'
            ? 'beforebegin'
            : placement.position === 'inside'
              ? 'beforeend'
              : 'afterend';

        if (insertTarget === 'beforeend') {
          host.className = 'w-full my-4';
        }

        anchor.insertAdjacentElement(insertTarget, host);
        hostsRef.current.push(host);
        nextPortals.push({
          placement,
          ads: adsForPlacement,
          host,
        });
      }

      setMountedPortals(nextPortals);
    };

    const t1 = window.setTimeout(() => mountAvailablePortals(false), 60);
    const t2 = window.setTimeout(() => mountAvailablePortals(true), 650);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      cleanupHosts();
    };
  }, [adState, location.pathname, location.search, isPrivilegedAdmin, reportAnchorStatus]);

  return (
    <>
      {mountedPortals.map(({ placement, ads, host }) =>
        createPortal(
          <aside
            key={placement.id}
            aria-label={`Advertisement (${placement.name})`}
            data-ad-placement-id={placement.id}
            className="w-full space-y-3"
          >
            {ads.map((ad) => (
              <div
                key={ad.id}
                className="rounded-2xl bg-[#FAF7F2]/92 border border-[#264653]/12 p-3 sm:p-4 overflow-hidden"
              >
                <div className="flex items-center justify-between gap-2 mb-2 px-1">
                  <span className="text-[11px] font-mono text-[#264653]/55">
                    Advertisement
                  </span>
                  <span className="text-[11px] font-mono text-[#264653]/45 truncate">
                    {ad.provider}
                  </span>
                </div>
                <SandboxedAdFrame ad={ad} />
              </div>
            ))}
          </aside>,
          host
        )
      )}
    </>
  );
}
