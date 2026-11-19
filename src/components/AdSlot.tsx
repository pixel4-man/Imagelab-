import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActiveAdState, fetchPublicActiveAds } from '../lib/adsPersistence';
import { buildSandboxedAdSrcDoc } from '../lib/adFrameHtml';
import {
  AdRecord,
  hasOwnInteractiveOrScriptElements,
  normalizePageRoute,
  validateSafeHttpUrl,
} from '../types/ads';

export { buildSandboxedAdSrcDoc };
export const ADS_UPDATED_EVENT = 'imagelab-ads-updated';
const ADS_STORAGE_SYNC_KEY = 'imagelab_ads_sync_ts';
export type { ActiveAdState };

export type AdRenderStatus = 'loading' | 'loaded' | 'empty' | 'error' | 'popunder_ready';

let cachedActiveState: ActiveAdState | null = null;
let cachedAt = 0;
let inflightStateRequest: Promise<ActiveAdState> | null = null;
const CACHE_TTL_MS = 15_000;

export function notifyActiveAdsUpdated() {
  cachedActiveState = null;
  cachedAt = 0;
  inflightStateRequest = null;
  try {
    localStorage.setItem(ADS_STORAGE_SYNC_KEY, String(Date.now()));
  } catch {
    // Ignore storage errors
  }
  window.dispatchEvent(new CustomEvent(ADS_UPDATED_EVENT));
}

// Queries /api/ads/active first, with active-only Firestore publicAdSlots fallback on static hosts
export async function fetchActiveAdState(forceFresh = false): Promise<ActiveAdState> {
  if (!forceFresh && cachedActiveState && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedActiveState;
  }
  if (!forceFresh && inflightStateRequest) return inflightStateRequest;

  inflightStateRequest = fetchPublicActiveAds()
    .then((next) => {
      cachedActiveState = next;
      cachedAt = Date.now();
      return next;
    })
    .catch(() => ({ placements: [], ads: [] }) as ActiveAdState)
    .finally(() => {
      inflightStateRequest = null;
    });

  return inflightStateRequest;
}

export function matchesPlacementRoute(pattern: string, currentPath: string): boolean {
  const normPattern = normalizePageRoute(pattern);
  const normCurrent = normalizePageRoute(currentPath);
  if (normPattern === '*' || normPattern === normCurrent) return true;
  if (normPattern.endsWith('/*')) {
    const base = normPattern.slice(0, -2) || '/';
    return normCurrent === base || normCurrent.startsWith(`${base}/`);
  }
  return false;
}

export function SandboxedAdFrame({
  ad,
  testMode = false,
  onStatusChange,
}: {
  ad: AdRecord;
  testMode?: boolean;
  onStatusChange?: (status: AdRenderStatus, message?: string) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const onStatusRef = useRef(onStatusChange);
  onStatusRef.current = onStatusChange;

  const [autoHeight, setAutoHeight] = useState<number>(() => {
    if (ad.height !== 'auto') {
      const parsed = parseInt(ad.height, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 110;
    }
    if (ad.adType === 'native_ad') return 140;
    if (ad.adType === 'responsive_banner') return 100;
    return 96;
  });

  useEffect(() => {
    if (ad.height !== 'auto') {
      const parsed = parseInt(ad.height, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        setAutoHeight(parsed);
      }
    }
    onStatusRef.current?.('loading');
  }, [ad.id, ad.scriptCode, ad.destinationUrl, ad.height, ad.width, ad.adType]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (iframeRef.current?.contentWindow && event.source !== iframeRef.current.contentWindow) {
        return;
      }
      const data = event.data as {
        type?: string;
        id?: string;
        status?: AdRenderStatus;
        height?: number;
        message?: string;
      } | null;
      if (!data || data.type !== 'imagelab-ad-status' || data.id !== ad.id) return;

      if (
        ad.height === 'auto' &&
        typeof data.height === 'number' &&
        data.height >= 24 &&
        data.height <= 900
      ) {
        setAutoHeight(Math.ceil(data.height));
      }
      if (data.status) {
        onStatusRef.current?.(data.status, data.message);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [ad.id, ad.height]);

  const srcDoc = useMemo(() => buildSandboxedAdSrcDoc(ad), [ad]);

  const frameWidth =
    ad.adType === 'responsive_banner' || ad.adType === 'native_ad' || ad.width === 'auto'
      ? '100%'
      : ad.width;

  const frameKey = `${ad.id}:${ad.adType}:${ad.width}:${ad.height}:${ad.destinationUrl || ''}:${ad.scriptCode.length}`;

  return (
    <iframe
      key={frameKey}
      ref={iframeRef}
      title={`Advertisement: ${ad.name}`}
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      loading="eager"
      scrolling="no"
      style={{
        width: frameWidth,
        maxWidth: '100%',
        height: ad.height === 'auto' ? `${autoHeight}px` : ad.height,
        border: 0,
        display: 'block',
        margin: '0 auto',
        overflow: 'hidden',
      }}
    />
  );
}

/**
 * Renders an active public advertisement safely and collapses cleanly
 * whenever no fill / error / zero output occurs so empty boxes never appear.
 */
export function LivePublicAdItem({
  ad,
  onVisibilityChange,
}: {
  ad: AdRecord;
  onVisibilityChange?: (adId: string, visible: boolean) => void;
}) {
  const [status, setStatus] = useState<AdRenderStatus>('loading');

  const handleStatus = useCallback(
    (nextStatus: AdRenderStatus) => {
      setStatus(nextStatus);
      onVisibilityChange?.(ad.id, nextStatus === 'loaded');
    },
    [ad.id, onVisibilityChange]
  );

  useEffect(() => {
    onVisibilityChange?.(ad.id, false);
    return () => onVisibilityChange?.(ad.id, false);
  }, [ad.id, onVisibilityChange]);

  if (status === 'empty' || status === 'error') {
    return null;
  }

  const isVisible = status === 'loaded';

  return (
    <div
      data-imagelab-ad-unit={ad.id}
      data-ad-render-status={status}
      className={
        isVisible
          ? 'rounded-2xl bg-[#FAF7F2]/92 border border-[#264653]/12 p-3 sm:p-4 overflow-hidden transition-opacity duration-200'
          : 'h-0 overflow-hidden opacity-0 pointer-events-none m-0 p-0 border-0'
      }
      aria-hidden={!isVisible}
    >
      {isVisible && (
        <div className="flex items-center justify-between gap-2 mb-2 px-1">
          <span className="text-[11px] font-mono text-[#264653]/55">Advertisement</span>
          <span className="text-[11px] font-mono text-[#264653]/45 truncate">
            {ad.provider}
          </span>
        </div>
      )}
      <SandboxedAdFrame ad={ad} onStatusChange={handleStatus} />
    </div>
  );
}

interface AdSlotProps {
  placementId?: string;
  placementName?: string;
  className?: string;
  testMode?: boolean;
  adOverride?: AdRecord | null;
}

export function AdSlot({
  placementId,
  placementName,
  className = '',
  testMode = false,
  adOverride = null,
}: AdSlotProps) {
  const [status, setStatus] = useState<AdRenderStatus>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const handleStatus = useCallback((nextStatus: AdRenderStatus, msg?: string) => {
    setStatus(nextStatus);
    setErrorMessage(msg || '');
  }, []);

  if (!adOverride) return null;

  if (!testMode) {
    return <LivePublicAdItem ad={adOverride} />;
  }

  const hasDest = Boolean(validateSafeHttpUrl(adOverride.destinationUrl).sanitized);
  const ownsClickables = hasOwnInteractiveOrScriptElements(adOverride.scriptCode);

  return (
    <aside
      aria-label="Advertisement Preview"
      data-ad-placement-id={placementId || adOverride.placementId}
      data-ad-test-mode="true"
      className={`w-full ${className}`}
    >
      <div className="rounded-2xl bg-[#FAF7F2] border border-[#264653]/14 p-3 sm:p-4 overflow-hidden space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <span className="text-[11px] font-mono text-[#264653]/65">
            Preview Test Mode · {adOverride.width} × {adOverride.height}
            {placementName ? ` · ${placementName}` : ''}
          </span>
          <span className="text-[11px] font-mono text-[#2A9D8F] font-semibold">
            {adOverride.provider}
          </span>
        </div>

        <div className="rounded-xl bg-white/75 border border-[#264653]/10 p-2 overflow-x-auto">
          <SandboxedAdFrame ad={adOverride} testMode onStatusChange={handleStatus} />
        </div>

        {status === 'loading' && (
          <p className="text-[11px] text-[#264653]/60 px-1">
            Rendering isolated preview inside sandboxed container...
          </p>
        )}

        {status === 'loaded' && (
          <p className="text-[11px] text-[#2A9D8F] font-medium px-1">
            Creative rendered inside sandboxed iframe
            {hasDest && !ownsClickables
              ? ' · Clicking banner opens Destination URL in new tab.'
              : hasDest && ownsClickables
                ? ' · Snippet already contains links/scripts; original click behavior preserved.'
                : '.'}
          </p>
        )}

        {status === 'popunder_ready' && (
          <p className="text-[11px] text-[#264653]/75 font-medium px-1">
            Popunder script loaded without errors (popunder creatives do not render a visible banner box).
          </p>
        )}

        {(status === 'error' || status === 'empty') && (
          <div
            role="alert"
            className="rounded-xl bg-[#E76F51]/10 border border-[#E76F51]/35 px-3 py-2 text-xs text-[#9A3412]"
          >
            <strong>Preview Error:</strong>{' '}
            {errorMessage ||
              'The submitted ad script or snippet could not render visible content (check script tags, external URL reachability, or ad-blocker rules).'}
          </div>
        )}
      </div>
    </aside>
  );
}
