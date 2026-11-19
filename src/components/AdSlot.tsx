import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Info,
  Loader2,
  Monitor,
  ShieldAlert,
  Smartphone,
} from 'lucide-react';
import { ActiveAdState, fetchPublicActiveAds } from '../lib/adsPersistence';
import { AdFrameRenderStatus, buildSandboxedAdSrcDoc } from '../lib/adFrameHtml';
import {
  AdRecord,
  extractAtOptionsMetadata,
  hasOwnInteractiveOrScriptElements,
  normalizePageRoute,
  validateSafeHttpUrl,
} from '../types/ads';

export { buildSandboxedAdSrcDoc };
export const ADS_UPDATED_EVENT = 'imagelab-ads-updated';
const ADS_STORAGE_SYNC_KEY = 'imagelab_ads_sync_ts';
export type { ActiveAdState };

export type AdRenderStatus = AdFrameRenderStatus;

let cachedActiveState: ActiveAdState | null = null;
let cachedAt = 0;
let inflightStateRequest: Promise<ActiveAdState> | null = null;
const CACHE_TTL_MS = 15_000;

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function parsePixelDimension(raw?: string): number | null {
  if (!raw || raw === 'auto') return null;
  const trimmed = raw.trim().toLowerCase();
  if (/^\d+(px)?$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

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
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const onStatusRef = useRef(onStatusChange);
  onStatusRef.current = onStatusChange;

  const atMeta = useMemo(() => extractAtOptionsMetadata(ad.scriptCode), [ad.scriptCode]);
  const effectiveWidth =
    ad.width && ad.width !== 'auto' ? ad.width : atMeta.width || 'auto';
  const effectiveHeight =
    ad.height && ad.height !== 'auto' ? ad.height : atMeta.height || 'auto';

  const fixedWidthPx = parsePixelDimension(effectiveWidth);
  const fixedHeightPx = parsePixelDimension(effectiveHeight);

  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [autoHeight, setAutoHeight] = useState<number>(() => {
    if (fixedHeightPx) return fixedHeightPx;
    if (ad.adType === 'native_ad') return 140;
    if (ad.adType === 'responsive_banner') return 100;
    return 96;
  });

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const nextWidth = Math.floor(el.getBoundingClientRect().width || 0);
      if (nextWidth > 0) setContainerWidth(nextWidth);
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (fixedHeightPx) {
      setAutoHeight(fixedHeightPx);
    }
    onStatusRef.current?.('loading');
  }, [ad.id, ad.scriptCode, ad.destinationUrl, fixedHeightPx, effectiveWidth, ad.adType]);

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
        !fixedHeightPx &&
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
  }, [ad.id, fixedHeightPx]);

  const srcDoc = useMemo(() => buildSandboxedAdSrcDoc(ad), [ad]);

  const intrinsicWidth =
    ad.adType === 'responsive_banner' || ad.adType === 'native_ad' || effectiveWidth === 'auto'
      ? '100%'
      : effectiveWidth;
  const intrinsicHeightPx = fixedHeightPx || autoHeight;

  const scale =
    fixedWidthPx && containerWidth > 0 && fixedWidthPx > containerWidth
      ? Math.max(0.25, containerWidth / fixedWidthPx)
      : 1;

  const scriptHash = useMemo(() => hashString(ad.scriptCode || ''), [ad.scriptCode]);
  const frameKey = `${ad.id}:${ad.adType}:${effectiveWidth}:${effectiveHeight}:${ad.destinationUrl || ''}:${scriptHash}`;

  const scaledWidthPx = fixedWidthPx ? Math.floor(fixedWidthPx * scale) : null;
  const scaledHeightPx = Math.ceil(intrinsicHeightPx * scale);

  return (
    <div
      ref={wrapperRef}
      data-ad-frame-wrapper={testMode ? 'preview' : 'live'}
      className="w-full flex justify-center overflow-hidden"
    >
      <div
        style={{
          width: scaledWidthPx ? `${scaledWidthPx}px` : intrinsicWidth,
          maxWidth: '100%',
          height: `${scaledHeightPx}px`,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <iframe
          key={frameKey}
          ref={iframeRef}
          title={`Advertisement: ${ad.name}`}
          srcDoc={srcDoc}
          sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="strict-origin-when-cross-origin"
          loading="eager"
          scrolling="no"
          style={{
            width: fixedWidthPx ? `${fixedWidthPx}px` : intrinsicWidth,
            height: `${intrinsicHeightPx}px`,
            border: 0,
            display: 'block',
            overflow: 'hidden',
            transform: scale < 1 ? `scale(${scale})` : undefined,
            transformOrigin: 'top left',
          }}
        />
      </div>
    </div>
  );
}

/**
 * Renders an active public advertisement inside its isolated sandboxed container
 * with configured dimensions, collapsing cleanly on no_inventory, script_blocked, or error.
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
      onVisibilityChange?.(
        ad.id,
        nextStatus === 'loaded' || nextStatus === 'preview_unsupported'
      );
    },
    [ad.id, onVisibilityChange]
  );

  useEffect(() => {
    onVisibilityChange?.(ad.id, false);
    return () => onVisibilityChange?.(ad.id, false);
  }, [ad.id, onVisibilityChange]);

  if (status === 'no_inventory' || status === 'script_blocked' || status === 'error') {
    return null;
  }

  const isVisible = status === 'loaded' || status === 'preview_unsupported';

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

function getPreviewStatusBadge(status: AdRenderStatus): {
  label: string;
  className: string;
} {
  switch (status) {
    case 'script_loaded':
      return {
        label: 'Script Loaded',
        className: 'bg-[#264653]/10 text-[#264653]',
      };
    case 'preview_unsupported':
      return {
        label: 'Preview Unsupported',
        className: 'bg-[#264653]/12 text-[#264653]',
      };
    case 'loaded':
      return {
        label: 'Ad Rendered',
        className: 'bg-[#2A9D8F]/15 text-[#218175]',
      };
    case 'no_inventory':
      return {
        label: 'Ad Unavailable',
        className: 'bg-[#E9C46A]/35 text-[#7A530B]',
      };
    case 'script_blocked':
      return {
        label: 'Script Blocked',
        className: 'bg-[#E76F51]/15 text-[#9A3412]',
      };
    case 'error':
      return {
        label: 'Script Error',
        className: 'bg-[#E76F51]/15 text-[#9A3412]',
      };
    case 'popunder_ready':
      return {
        label: 'Popunder Ready',
        className: 'bg-[#264653]/10 text-[#264653]',
      };
    default:
      return {
        label: 'Loading Preview',
        className: 'bg-[#264653]/8 text-[#264653]/75',
      };
  }
}

export function AdSlot({
  placementId,
  placementName,
  className = '',
  testMode = false,
  adOverride = null,
}: AdSlotProps) {
  const [status, setStatus] = useState<AdRenderStatus>('loading');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [viewportMode, setViewportMode] = useState<'desktop' | 'mobile'>('desktop');

  const handleStatus = useCallback((nextStatus: AdRenderStatus, msg?: string) => {
    setStatus(nextStatus);
    if (msg !== undefined) setStatusMessage(msg);
  }, []);

  useEffect(() => {
    setStatus('loading');
    setStatusMessage('');
  }, [adOverride?.id, adOverride?.scriptCode, adOverride?.width, adOverride?.height, adOverride?.adType]);

  if (!adOverride) return null;

  if (!testMode) {
    return <LivePublicAdItem ad={adOverride} />;
  }

  const atMeta = extractAtOptionsMetadata(adOverride.scriptCode);
  const displayWidth =
    adOverride.width && adOverride.width !== 'auto'
      ? adOverride.width
      : atMeta.width || 'auto';
  const displayHeight =
    adOverride.height && adOverride.height !== 'auto'
      ? adOverride.height
      : atMeta.height || 'auto';

  const hasDest = Boolean(validateSafeHttpUrl(adOverride.destinationUrl).sanitized);
  const ownsClickables = hasOwnInteractiveOrScriptElements(adOverride.scriptCode);

  const isPendingState = status === 'loading' || status === 'script_loaded';
  const isRendered = status === 'loaded';
  const badge = getPreviewStatusBadge(status);

  return (
    <aside
      aria-label="Advertisement Preview"
      data-ad-placement-id={placementId || adOverride.placementId}
      data-ad-test-mode="true"
      data-ad-preview-status={status}
      className={`w-full ${className}`}
    >
      <div className="rounded-2xl bg-[#FAF7F2] border border-[#264653]/14 p-3 sm:p-4 overflow-hidden space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="text-[11px] font-mono text-[#264653]/75">
              Preview · {displayWidth} × {displayHeight}
              {placementName ? ` · ${placementName}` : ''}
            </span>
            <span className="px-2 py-0.5 rounded-md bg-[#2A9D8F]/12 text-[#218175] text-[11px] font-mono font-semibold">
              {adOverride.provider}
            </span>
            <span
              data-ad-status-badge={status}
              className={`px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold ${badge.className}`}
            >
              {badge.label}
            </span>
          </div>

          <div
            role="group"
            aria-label="Preview viewport width"
            className="inline-flex items-center rounded-lg border border-[#264653]/15 bg-white p-0.5"
          >
            <button
              type="button"
              onClick={() => setViewportMode('desktop')}
              aria-pressed={viewportMode === 'desktop'}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                viewportMode === 'desktop'
                  ? 'bg-[#264653] text-white'
                  : 'text-[#264653]/70 hover:text-[#264653]'
              }`}
            >
              <Monitor className="w-3 h-3" />
              <span>Desktop</span>
            </button>
            <button
              type="button"
              onClick={() => setViewportMode('mobile')}
              aria-pressed={viewportMode === 'mobile'}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                viewportMode === 'mobile'
                  ? 'bg-[#264653] text-white'
                  : 'text-[#264653]/70 hover:text-[#264653]'
              }`}
            >
              <Smartphone className="w-3 h-3" />
              <span>Mobile</span>
            </button>
          </div>
        </div>

        {/* Sandboxed Execution Container: shown visibly ONLY when verified creative rendered */}
        <div
          className={
            isRendered
              ? `rounded-xl bg-white border border-[#264653]/12 p-2.5 mx-auto transition-all ${
                  viewportMode === 'mobile' ? 'w-full max-w-[375px]' : 'w-full'
                }`
              : 'h-0 overflow-hidden opacity-0 pointer-events-none m-0 p-0 border-0'
          }
          aria-hidden={!isRendered}
        >
          <SandboxedAdFrame ad={adOverride} testMode onStatusChange={handleStatus} />
        </div>

        {/* Distinct Status Diagnostics */}
        {isPendingState && (
          <div
            role="status"
            className="rounded-xl bg-[#F4EDE4] border border-[#264653]/15 px-3.5 py-3 flex items-start gap-2.5 text-xs text-[#264653]"
          >
            <Loader2 className="w-4 h-4 text-[#2A9D8F] animate-spin shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-bold">
                {status === 'script_loaded' ? 'Script Loaded' : 'Loading Sandbox Preview'}
              </p>
              <p className="text-[#264653]/75">
                {statusMessage ||
                  (status === 'script_loaded'
                    ? 'External ad script loaded; verifying visible creative output...'
                    : 'Executing submitted snippet inside isolated sandbox without parent DOM, cookies, or auth access...')}
              </p>
            </div>
          </div>
        )}

        {status === 'loaded' && (
          <div
            role="status"
            className="rounded-xl bg-[#2A9D8F]/10 border border-[#2A9D8F]/30 px-3.5 py-2.5 flex items-start gap-2.5 text-xs text-[#264653]"
          >
            <CheckCircle2 className="w-4 h-4 text-[#2A9D8F] shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-bold text-[#218175]">Ad Rendered</p>
              <p className="text-[#264653]/80">
                {statusMessage || 'Visible creative output verified inside sandboxed container.'}
                {hasDest && !ownsClickables
                  ? ' Clicking banner opens Destination URL in a new tab.'
                  : hasDest && ownsClickables
                    ? ' Snippet already contains links/scripts; original click behavior preserved.'
                    : ''}
              </p>
            </div>
          </div>
        )}

        {status === 'no_inventory' && (
          <div
            role="alert"
            className="rounded-xl bg-[#E9C46A]/20 border border-[#B0892B]/35 px-3.5 py-3 flex items-start gap-2.5 text-xs text-[#264653]"
          >
            <Info className="w-4 h-4 text-[#9A6B13] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold text-[#7A530B]">Ad Unavailable</p>
              <p className="text-[#264653]/85 leading-relaxed">
                {statusMessage ||
                  'The advertisement script loaded and ran without errors, but returned no ad inventory or visible creative.'}
              </p>
            </div>
          </div>
        )}

        {status === 'script_blocked' && (
          <div
            role="alert"
            className="rounded-xl bg-[#E76F51]/12 border border-[#E76F51]/40 px-3.5 py-3 flex items-start gap-2.5 text-xs text-[#264653]"
          >
            <ShieldAlert className="w-4 h-4 text-[#D05A3C] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold text-[#9A3412]">Script Blocked</p>
              <p className="text-[#264653]/85 leading-relaxed">
                {statusMessage ||
                  'External advertisement script or frame was blocked (check ad-blocker extensions, Brave Shields, CSP rules, or script URL).'}
              </p>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div
            role="alert"
            className="rounded-xl bg-[#E76F51]/12 border border-[#E76F51]/40 px-3.5 py-3 flex items-start gap-2.5 text-xs text-[#264653]"
          >
            <AlertCircle className="w-4 h-4 text-[#D05A3C] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold text-[#9A3412]">Script Error</p>
              <p className="text-[#264653]/85 leading-relaxed">
                {statusMessage ||
                  'The submitted advertisement script threw a JavaScript error or failed to load its creative asset.'}
              </p>
            </div>
          </div>
        )}

        {status === 'preview_unsupported' && (
          <div
            role="status"
            className="rounded-xl bg-[#264653]/7 border border-[#264653]/20 px-3.5 py-3 flex items-start gap-2.5 text-xs text-[#264653]"
          >
            <ShieldAlert className="w-4 h-4 text-[#264653] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold text-[#264653]">Preview Unsupported</p>
              <p className="font-medium text-[#264653]">
                Live preview unavailable for this advertising provider.
              </p>
              <p className="text-[#264653]/80 leading-relaxed">
                Strict sandbox isolation remains enabled so parent DOM, Firebase authentication tokens, cookies, and private data are never exposed. You can still save this advertisement and test it on the actual published website, where it renders inside its isolated ad container at {displayWidth} × {displayHeight}.
              </p>
              {statusMessage && (
                <p className="text-[11px] font-mono text-[#264653]/70 pt-0.5">
                  {statusMessage}
                </p>
              )}
            </div>
          </div>
        )}

        {status === 'popunder_ready' && (
          <div
            role="status"
            className="rounded-xl bg-[#264653]/6 border border-[#264653]/15 px-3.5 py-3 flex items-start gap-2.5 text-xs text-[#264653]"
          >
            <Info className="w-4 h-4 text-[#2A9D8F] shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-bold">Popunder Script Loaded</p>
              <p className="text-[#264653]/80">
                {statusMessage ||
                  'Popunder script executed without errors (popunder creatives trigger on click rather than rendering a visible banner box).'}
              </p>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
