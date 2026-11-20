import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { getPredefinedActiveAdState } from '../lib/adsPersistence';
import {
  extractAdsterraZoneKey,
  getPlacementDeviceTarget,
} from '../lib/adsterraZones';
import { AdRecord, VisualPlacementRecord } from '../types/ads';
import {
  AdRenderStatus,
  LivePublicAdItem,
  matchesPlacementRoute,
} from './AdSlot';

const IS_DEV_INJECTOR = Boolean(import.meta.env?.DEV);

interface MountedSlotPortal {
  placement: VisualPlacementRecord;
  ads: AdRecord[];
  anchor: HTMLElement;
  host: HTMLDivElement;
}

const ADMIN_OR_AUTH_PREFIXES = ['/admin', '/super-admin', '/login', '/signup'];

export function isPublicAdRoute(pathname: string): boolean {
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
      // Ignore invalid CSS selectors
    }
  }
  return null;
}

const PlacementAdPortalGroup = React.memo(function PlacementAdPortalGroup({
  placement,
  ads,
  anchor,
  host,
}: {
  placement: VisualPlacementRecord;
  ads: AdRecord[];
  anchor: HTMLElement;
  host: HTMLDivElement;
}) {
  const [visibleMap, setVisibleMap] = useState<Record<string, boolean>>({});
  const [statusMap, setStatusMap] = useState<Record<string, AdRenderStatus>>({});

  const handleVisibilityChange = useCallback((adId: string, visible: boolean) => {
    setVisibleMap((prev) => {
      if (Boolean(prev[adId]) === visible) return prev;
      return { ...prev, [adId]: visible };
    });
  }, []);

  const handleRenderStateChange = useCallback((adId: string, status: AdRenderStatus) => {
    setStatusMap((prev) => {
      if (prev[adId] === status) return prev;
      return { ...prev, [adId]: status };
    });
  }, []);

  const hasAnyVisible = ads.some((a) => visibleMap[a.id]);
  const aggregateStatus = ads.map((a) => statusMap[a.id] || 'loading').join(',');

  useEffect(() => {
    if (hasAnyVisible) {
      host.className =
        placement.position === 'inside'
          ? 'w-full my-2'
          : 'w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 my-4';
      anchor.setAttribute('data-ad-has-visible', 'true');
    } else {
      host.className = 'w-full h-0 overflow-hidden m-0 p-0';
      anchor.setAttribute('data-ad-has-visible', 'false');
    }
    anchor.setAttribute('data-ad-zone-status', aggregateStatus);
  }, [aggregateStatus, anchor, hasAnyVisible, host, placement.position]);

  useEffect(() => {
    return () => {
      anchor.setAttribute('data-ad-has-visible', 'false');
      anchor.removeAttribute('data-ad-zone-status');
    };
  }, [anchor]);

  return createPortal(
    <aside
      aria-label={`Advertisement (${placement.name})`}
      data-ad-placement-id={placement.id}
      data-ad-slot-id={placement.slotId}
      className={hasAnyVisible ? 'w-full space-y-3' : 'w-full'}
    >
      {ads.map((ad) => (
        <LivePublicAdItem
          key={ad.id}
          ad={ad}
          placementId={placement.id}
          slotId={placement.slotId}
          onVisibilityChange={handleVisibilityChange}
          onRenderStateChange={handleRenderStateChange}
        />
      ))}
    </aside>,
    host
  );
});

export function VisualAdInjector() {
  const location = useLocation();
  const adState = useMemo(() => getPredefinedActiveAdState(), []);
  const [mountedPortals, setMountedPortals] = useState<MountedSlotPortal[]>([]);
  const [isDesktopViewport, setIsDesktopViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 1024px)').matches
      : true
  );
  const activePortalsRef = useRef<Map<string, MountedSlotPortal>>(new Map());
  const lastRouteLogRef = useRef<string>('');

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const syncViewport = () => setIsDesktopViewport(mq.matches);
    syncViewport();
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', syncViewport);
      return () => mq.removeEventListener('change', syncViewport);
    }
    mq.addListener(syncViewport);
    return () => mq.removeListener(syncViewport);
  }, []);

  useEffect(() => {
    const unmountAllPortals = () => {
      for (const portal of activePortalsRef.current.values()) {
        try {
          portal.host.remove();
        } catch {
          // Ignore already removed DOM nodes
        }
      }
      activePortalsRef.current.clear();
      setMountedPortals([]);
    };

    if (!isPublicAdRoute(location.pathname)) {
      unmountAllPortals();
      const nonPublicSig = `skip:${location.pathname}`;
      if (IS_DEV_INJECTOR && lastRouteLogRef.current !== nonPublicSig) {
        lastRouteLogRef.current = nonPublicSig;
        console.info(`[ImageLab Ads] Skipped ad mounting on non-public route ${location.pathname}`);
      }
      return;
    }

    const matchingPlacements = adState.placements.filter(
      (p) => p.status === 'active' && matchesPlacementRoute(p.pageRoute, location.pathname)
    );

    const desiredByPlacementId = new Map<
      string,
      { placement: VisualPlacementRecord; ads: AdRecord[] }
    >();
    const seenZoneKeys = new Set<string>();

    for (const placement of matchingPlacements) {
      const rawAds = adState.ads
        .filter((a) => a.status === 'active' && a.placementId === placement.id)
        .sort((a, b) => a.priority - b.priority);

      if (rawAds.length === 0) continue;

      const deviceTarget = getPlacementDeviceTarget(placement, rawAds);
      if (deviceTarget === 'desktop' && !isDesktopViewport) continue;
      if (deviceTarget === 'mobile' && isDesktopViewport) continue;

      const dedupedAds: AdRecord[] = [];
      for (const ad of rawAds) {
        const zoneKey = extractAdsterraZoneKey(ad);
        if (zoneKey && seenZoneKeys.has(zoneKey)) continue;
        if (zoneKey) seenZoneKeys.add(zoneKey);
        dedupedAds.push(ad);
      }

      if (dedupedAds.length > 0) {
        desiredByPlacementId.set(placement.id, { placement, ads: dedupedAds });
      }
    }

    const syncPortals = () => {
      let changed = false;
      const nextMap = new Map<string, MountedSlotPortal>();

      // Remove placements no longer active on this route/viewport or whose anchor unmounted
      for (const [placementId, existing] of activePortalsRef.current.entries()) {
        const desired = desiredByPlacementId.get(placementId);
        const currentAnchor = desired ? findAnchorElement(desired.placement) : null;
        if (!desired || !currentAnchor || currentAnchor !== existing.anchor || !existing.host.isConnected) {
          try {
            existing.host.remove();
          } catch {
            // Ignore
          }
          changed = true;
        } else {
          // Preserve exact existing host & iframe across route navigations / rerenders
          nextMap.set(placementId, {
            ...existing,
            placement: desired.placement,
            ads: desired.ads,
          });
        }
      }

      // Mount newly available placements that aren't already mounted
      for (const [placementId, { placement, ads }] of desiredByPlacementId.entries()) {
        if (nextMap.has(placementId)) continue;
        const anchor = findAnchorElement(placement);
        if (!anchor) continue;

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
        nextMap.set(placementId, {
          placement,
          ads,
          anchor,
          host,
        });
        changed = true;
      }

      if (changed) {
        activePortalsRef.current = nextMap;
        setMountedPortals(Array.from(nextMap.values()));
      }

      const activeZonesSummary = Array.from(nextMap.values())
        .flatMap((p) =>
          p.ads.map((a) => `${extractAdsterraZoneKey(a) || a.id}(${a.width}x${a.height}@${p.placement.slotId})`)
        )
        .join(', ');
      const routeSig = `${location.pathname}|${isDesktopViewport ? 'desktop' : 'mobile'}|${activeZonesSummary}`;
      if (IS_DEV_INJECTOR && lastRouteLogRef.current !== routeSig && activeZonesSummary) {
        lastRouteLogRef.current = routeSig;
        console.info(
          `[ImageLab Ads] Active zones for ${location.pathname} (${isDesktopViewport ? 'desktop' : 'mobile'}): ${activeZonesSummary}`
        );
      }
    };

    syncPortals();
    const t1 = window.setTimeout(syncPortals, 60);

    let raf = 0;
    const observer =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(() => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(syncPortals);
          })
        : null;

    if (observer && document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      window.clearTimeout(t1);
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [adState, isDesktopViewport, location.pathname]);

  // Clean up all ad hosts cleanly when VisualAdInjector unmounts completely
  useEffect(() => {
    return () => {
      for (const portal of activePortalsRef.current.values()) {
        try {
          portal.host.remove();
        } catch {
          // Ignore
        }
      }
      activePortalsRef.current.clear();
    };
  }, []);

  return (
    <>
      {mountedPortals.map(({ placement, ads, anchor, host }) => (
        <PlacementAdPortalGroup
          key={placement.id}
          placement={placement}
          ads={ads}
          anchor={anchor}
          host={host}
        />
      ))}
    </>
  );
}
