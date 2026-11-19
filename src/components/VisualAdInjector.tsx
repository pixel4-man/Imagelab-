import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { updateVisualPlacementAnchorStatus } from '../lib/adsPersistence';
import { AdRecord, VisualPlacementRecord } from '../types/ads';
import {
  ADS_UPDATED_EVENT,
  ActiveAdState,
  LivePublicAdItem,
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

function PlacementAdPortalGroup({
  placement,
  ads,
  host,
}: {
  placement: VisualPlacementRecord;
  ads: AdRecord[];
  host: HTMLDivElement;
}) {
  const [visibleMap, setVisibleMap] = useState<Record<string, boolean>>({});

  const handleVisibilityChange = useCallback((adId: string, visible: boolean) => {
    setVisibleMap((prev) => {
      if (Boolean(prev[adId]) === visible) return prev;
      return { ...prev, [adId]: visible };
    });
  }, []);

  const hasAnyVisible = ads.some((a) => visibleMap[a.id]);

  // Collapse outer host margins completely until at least one ad unit renders content
  useEffect(() => {
    if (hasAnyVisible) {
      host.className =
        placement.position === 'inside'
          ? 'w-full my-4'
          : 'w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 my-5';
    } else {
      host.className = 'w-full h-0 overflow-hidden m-0 p-0';
    }
  }, [hasAnyVisible, host, placement.position]);

  return createPortal(
    <aside
      aria-label={`Advertisement (${placement.name})`}
      data-ad-placement-id={placement.id}
      className={hasAnyVisible ? 'w-full space-y-3' : 'w-full'}
    >
      {ads.map((ad) => {
        const resolvedAd: AdRecord = {
          ...ad,
          width:
            ad.width && ad.width !== 'auto' ? ad.width : placement.width || 'auto',
          height:
            ad.height && ad.height !== 'auto' ? ad.height : placement.height || 'auto',
        };
        return (
          <LivePublicAdItem
            key={ad.id}
            ad={resolvedAd}
            onVisibilityChange={handleVisibilityChange}
          />
        );
      })}
    </aside>,
    host
  );
}

export function VisualAdInjector() {
  const location = useLocation();
  const { authReady, firebaseUser, userProfile, getIdToken } = useAuth();
  const [adState, setAdState] = useState<ActiveAdState>({ placements: [], ads: [] });
  const [mountedPortals, setMountedPortals] = useState<MountedSlotPortal[]>([]);
  const anchorSyncReportedRef = useRef<Set<string>>(new Set());
  const hostsRef = useRef<HTMLDivElement[]>([]);

  const isPrivilegedAdmin =
    Boolean(authReady && firebaseUser && userProfile) &&
    userProfile?.accountStatus === 'active' &&
    (userProfile?.role === 'admin' || userProfile?.role === 'super_admin');

  const reloadState = useCallback((forceFresh = false) => {
    fetchActiveAdState(forceFresh).then((next) => {
      setAdState(next);
    });
  }, []);

  useEffect(() => {
    reloadState(true);
    const onAdsUpdated = () => reloadState(true);
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === 'imagelab_ads_sync_ts') {
        reloadState(true);
      }
    };
    window.addEventListener(ADS_UPDATED_EVENT, onAdsUpdated);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(ADS_UPDATED_EVENT, onAdsUpdated);
      window.removeEventListener('storage', onStorage);
    };
  }, [reloadState, location.pathname]);

  const reportAnchorStatus = useCallback(
    async (placementId: string, anchorMissing: boolean) => {
      if (!isPrivilegedAdmin) return;
      const cacheKey = `${placementId}:${anchorMissing ? 'missing' : 'ok'}`;
      if (anchorSyncReportedRef.current.has(cacheKey)) return;
      anchorSyncReportedRef.current.add(cacheKey);
      await updateVisualPlacementAnchorStatus(placementId, anchorMissing, getIdToken);
    },
    [isPrivilegedAdmin, getIdToken]
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

    const activePairs: Array<{ placement: VisualPlacementRecord; ads: AdRecord[] }> = [];
    for (const placement of matchingPlacements) {
      const adsForPlacement = adState.ads
        .filter((a) => a.status === 'active' && a.placementId === placement.id)
        .sort((a, b) => a.priority - b.priority);
      if (adsForPlacement.length > 0) {
        activePairs.push({ placement, ads: adsForPlacement });
      }
    }

    if (activePairs.length === 0) {
      return cleanupHosts;
    }

    const mountAvailablePortals = (checkMissing: boolean) => {
      for (const h of hostsRef.current) {
        try {
          h.remove();
        } catch {
          // Ignore
        }
      }
      hostsRef.current = [];

      const nextPortals: MountedSlotPortal[] = [];

      for (const { placement, ads } of activePairs) {
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
        host.className = 'w-full h-0 overflow-hidden m-0 p-0';

        const insertTarget =
          placement.position === 'before'
            ? 'beforebegin'
            : placement.position === 'inside'
              ? 'beforeend'
              : 'afterend';

        anchor.insertAdjacentElement(insertTarget, host);
        hostsRef.current.push(host);
        nextPortals.push({
          placement,
          ads,
          host,
        });
      }

      setMountedPortals(nextPortals);
    };

    let lastSignature = '';
    const tryMountIfChanged = (checkMissing: boolean) => {
      const sig = activePairs
        .map(({ placement }) => `${placement.id}:${Boolean(findAnchorElement(placement))}`)
        .join('|');
      if (sig === lastSignature && !checkMissing) return;
      lastSignature = sig;
      mountAvailablePortals(checkMissing);
    };

    const t1 = window.setTimeout(() => tryMountIfChanged(false), 60);
    const t2 = window.setTimeout(() => tryMountIfChanged(true), 1200);

    let raf = 0;
    const observer =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(() => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => tryMountIfChanged(false));
          })
        : null;

    if (observer && document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      cancelAnimationFrame(raf);
      observer?.disconnect();
      cleanupHosts();
    };
  }, [adState, location.pathname, location.search, isPrivilegedAdmin, reportAnchorStatus]);

  return (
    <>
      {mountedPortals.map(({ placement, ads, host }) => (
        <PlacementAdPortalGroup
          key={placement.id}
          placement={placement}
          ads={ads}
          host={host}
        />
      ))}
    </>
  );
}
