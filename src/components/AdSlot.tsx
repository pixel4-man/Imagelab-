import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getPredefinedActiveAdState } from '../lib/adsPersistence';
import { AdFrameRenderStatus, buildSandboxedAdSrcDoc } from '../lib/adFrameHtml';
import { extractAdsterraZoneKey } from '../lib/adsterraZones';
import {
  AdRecord,
  extractAtOptionsMetadata,
  normalizePageRoute,
} from '../types/ads';

export { buildSandboxedAdSrcDoc };
export type { ActiveAdState } from '../lib/adsPersistence';
export type AdRenderStatus = AdFrameRenderStatus;

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

export function fetchActiveAdState() {
  return Promise.resolve(getPredefinedActiveAdState());
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

const IS_DEV = Boolean(import.meta.env?.DEV);

export interface AdZoneDiagnosticEvent {
  zoneKey: string;
  adId: string;
  placementId?: string;
  slotId?: string;
  dimensions: string;
  event: string;
  status: string;
  outcomeCategory?: string;
  responseStatus?: string;
  detail: string;
  url?: string;
  elapsedMs?: number;
  timestamp: string;
}

export interface AdZoneDiagnosticState {
  zoneKey: string;
  adId: string;
  placementId?: string;
  slotId?: string;
  dimensions: string;
  currentStatus: string;
  outcomeCategory?: string;
  responseStatus?: string;
  lastDetail: string;
  events: AdZoneDiagnosticEvent[];
}

function getDiagnosticsStore(): Record<string, AdZoneDiagnosticState> | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    __imagelabAdDiagnostics?: Record<string, AdZoneDiagnosticState>;
  };
  if (!win.__imagelabAdDiagnostics) {
    win.__imagelabAdDiagnostics = {};
  }
  return win.__imagelabAdDiagnostics;
}

function recordZoneDiagnostic(
  entry: Omit<AdZoneDiagnosticEvent, 'timestamp'>,
  level: 'info' | 'warn' = 'info'
) {
  const timestamp = new Date().toISOString();
  const fullEntry: AdZoneDiagnosticEvent = { ...entry, timestamp };
  if (IS_DEV) {
    const store = getDiagnosticsStore();
    if (store) {
      const existing = store[entry.zoneKey];
      if (existing) {
        existing.currentStatus = entry.status || existing.currentStatus;
        existing.outcomeCategory = entry.outcomeCategory || existing.outcomeCategory;
        existing.responseStatus = entry.responseStatus || existing.responseStatus;
        existing.lastDetail = entry.detail || existing.lastDetail;
        existing.events = [...existing.events.slice(-24), fullEntry];
      } else {
        store[entry.zoneKey] = {
          zoneKey: entry.zoneKey,
          adId: entry.adId,
          placementId: entry.placementId,
          slotId: entry.slotId,
          dimensions: entry.dimensions,
          currentStatus: entry.status || entry.event,
          outcomeCategory: entry.outcomeCategory,
          responseStatus: entry.responseStatus,
          lastDetail: entry.detail,
          events: [fullEntry],
        };
      }
    }
  }

  const slotLabel = entry.slotId ? `@${entry.slotId}` : '';
  const outcomeLabel = entry.outcomeCategory ? ` [${entry.outcomeCategory}]` : '';
  const httpLabel = entry.responseStatus ? ` (${entry.responseStatus})` : '';
  const prefix = `[ImageLab Ads][Zone ${entry.zoneKey}${slotLabel} (${entry.dimensions})] ${entry.event}${outcomeLabel}${httpLabel}`;
  const msg = `${prefix}: ${entry.detail}${entry.url ? ` | url=${entry.url}` : ''}${
    typeof entry.elapsedMs === 'number' ? ` (${entry.elapsedMs}ms)` : ''
  }`;
  if (level === 'warn') {
    console.warn(msg);
  } else if (IS_DEV) {
    console.info(msg);
  }
}

export const SandboxedAdFrame = React.memo(function SandboxedAdFrame({
  ad,
  placementId,
  slotId,
  onStatusChange,
  onOutcomeChange,
  onResponseStatusChange,
}: {
  ad: AdRecord;
  placementId?: string;
  slotId?: string;
  onStatusChange?: (status: AdRenderStatus, message?: string) => void;
  onOutcomeChange?: (outcome: string) => void;
  onResponseStatusChange?: (responseStatus: string) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const onStatusRef = useRef(onStatusChange);
  onStatusRef.current = onStatusChange;
  const onOutcomeRef = useRef(onOutcomeChange);
  onOutcomeRef.current = onOutcomeChange;
  const onResponseStatusRef = useRef(onResponseStatusChange);
  onResponseStatusRef.current = onResponseStatusChange;
  const seenDiagRef = useRef<Set<string>>(new Set());

  const atMeta = useMemo(() => extractAtOptionsMetadata(ad.scriptCode), [ad.scriptCode]);
  const zoneKey = useMemo(
    () => extractAdsterraZoneKey(ad) || atMeta.key || ad.id,
    [ad, atMeta.key]
  );
  const effectiveWidth =
    ad.width && ad.width !== 'auto' ? ad.width : atMeta.width || 'auto';
  const effectiveHeight =
    ad.height && ad.height !== 'auto' ? ad.height : atMeta.height || 'auto';
  const dimensionsLabel = `${effectiveWidth}x${effectiveHeight}`;

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
    seenDiagRef.current.clear();
    const scriptSrcMatch = (ad.scriptCode || '').match(/<script[^>]*\bsrc=["']([^"']+)["']/i);
    recordZoneDiagnostic(
      {
        zoneKey,
        adId: ad.id,
        placementId,
        slotId,
        dimensions: dimensionsLabel,
        event: 'zone_mounted',
        status: 'loading',
        detail: `Mounted isolated sandboxed iframe for ${ad.name}`,
        url: scriptSrcMatch ? scriptSrcMatch[1] : undefined,
      },
      'info'
    );
    onStatusRef.current?.('loading');
  }, [
    ad.id,
    ad.name,
    ad.scriptCode,
    ad.destinationUrl,
    fixedHeightPx,
    effectiveWidth,
    ad.adType,
    zoneKey,
    placementId,
    slotId,
    dimensionsLabel,
  ]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (iframeRef.current?.contentWindow && event.source !== iframeRef.current.contentWindow) {
        return;
      }
      const data = event.data as {
        type?: string;
        id?: string;
        zoneKey?: string;
        event?: string;
        status?: AdRenderStatus;
        outcomeCategory?: string;
        responseStatus?: string;
        height?: number;
        message?: string;
        detail?: string;
        url?: string;
        elapsedMs?: number;
      } | null;
      if (!data || data.id !== ad.id) return;

      if (data.type === 'imagelab-ad-diagnostic' && data.event) {
        if (data.outcomeCategory) {
          onOutcomeRef.current?.(data.outcomeCategory);
        }
        if (data.responseStatus) {
          onResponseStatusRef.current?.(data.responseStatus);
        }
        const dedupeKey = `${data.event}|${data.status || ''}|${data.url || ''}|${data.detail || ''}`;
        if (!seenDiagRef.current.has(dedupeKey)) {
          seenDiagRef.current.add(dedupeKey);
          const isWarn =
            data.event === 'script_failed' ||
            data.event === 'empty_response' ||
            data.event === 'timeout' ||
            data.event === 'browser_restriction';
          recordZoneDiagnostic(
            {
              zoneKey: data.zoneKey || zoneKey,
              adId: ad.id,
              placementId,
              slotId,
              dimensions: dimensionsLabel,
              event: data.event,
              status: data.status || '',
              outcomeCategory: data.outcomeCategory,
              responseStatus: data.responseStatus,
              detail: data.detail || '',
              url: data.url || undefined,
              elapsedMs: data.elapsedMs,
            },
            isWarn ? 'warn' : 'info'
          );
        }
        return;
      }

      if (data.type !== 'imagelab-ad-status') return;

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
  }, [ad.id, fixedHeightPx, zoneKey, placementId, slotId, dimensionsLabel]);

  useEffect(() => {
    return () => {
      const frame = iframeRef.current;
      if (frame) {
        try {
          frame.removeAttribute('srcdoc');
          frame.src = 'about:blank';
        } catch {
          // Ignore teardown errors
        }
      }
      recordZoneDiagnostic(
        {
          zoneKey,
          adId: ad.id,
          placementId,
          slotId,
          dimensions: dimensionsLabel,
          event: 'cleanup_unmounted',
          status: 'unmounted',
          detail: 'Disposed sandboxed ad frame container.',
        },
        'info'
      );
    };
  }, [ad.id, zoneKey, placementId, slotId, dimensionsLabel]);

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
      data-ad-frame-wrapper="live"
      className="w-full flex justify-center overflow-hidden"
    >
      <div
        style={{
          width: scaledWidthPx ? `${scaledWidthPx}px` : intrinsicWidth,
          maxWidth: '100%',
          height: `${scaledHeightPx}px`,
          aspectRatio:
            fixedWidthPx && fixedHeightPx ? `${fixedWidthPx} / ${fixedHeightPx}` : undefined,
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
});

const TERMINAL_FAILED_STATUSES = new Set<AdRenderStatus>([
  'no_inventory',
  'rendering_blocked',
  'script_blocked',
  'timeout',
  'error',
]);

/**
 * Renders an automatic Adsterra zone inside an isolated sandboxed container
 * with its configured dimensions and natural aspect ratio.
 * Collapses cleanly when no inventory is returned or rendering is blocked, and
 * unmounts the sandboxed frame on terminal failure to avoid idle memory usage.
 */
export const LivePublicAdItem = React.memo(function LivePublicAdItem({
  ad,
  placementId,
  slotId,
  onVisibilityChange,
  onRenderStateChange,
}: {
  ad: AdRecord;
  placementId?: string;
  slotId?: string;
  onVisibilityChange?: (adId: string, visible: boolean) => void;
  onRenderStateChange?: (adId: string, status: AdRenderStatus, detail?: string) => void;
}) {
  const [status, setStatus] = useState<AdRenderStatus>('loading');
  const [statusDetail, setStatusDetail] = useState<string>('');
  const [outcomeCategory, setOutcomeCategory] = useState<string>('');
  const [responseStatus, setResponseStatus] = useState<string>('');
  const zoneKey = useMemo(() => extractAdsterraZoneKey(ad) || '', [ad]);

  const handleStatus = useCallback(
    (nextStatus: AdRenderStatus, message?: string) => {
      setStatus(nextStatus);
      if (message !== undefined) {
        setStatusDetail(message);
      }
      onRenderStateChange?.(ad.id, nextStatus, message);
      onVisibilityChange?.(
        ad.id,
        nextStatus === 'loaded' || nextStatus === 'preview_unsupported'
      );
    },
    [ad.id, onRenderStateChange, onVisibilityChange]
  );

  useEffect(() => {
    setStatus('loading');
    setStatusDetail('');
    setOutcomeCategory('');
    setResponseStatus('');
    onRenderStateChange?.(ad.id, 'loading');
    onVisibilityChange?.(ad.id, false);
    return () => onVisibilityChange?.(ad.id, false);
  }, [ad.id, onRenderStateChange, onVisibilityChange]);

  const isFailed = TERMINAL_FAILED_STATUSES.has(status);
  const isVisible = status === 'loaded' || status === 'preview_unsupported';

  return (
    <div
      data-imagelab-ad-unit={ad.id}
      data-ad-zone-key={zoneKey || undefined}
      data-ad-placement-id={placementId || ad.placementId || undefined}
      data-ad-dimensions={`${ad.width}x${ad.height}`}
      data-ad-render-status={status}
      data-ad-outcome={outcomeCategory || undefined}
      data-ad-response-status={responseStatus || undefined}
      data-ad-status-detail={statusDetail || undefined}
      className={
        isVisible
          ? 'rounded-2xl bg-[#FAF7F2]/92 border border-[#264653]/12 p-1.5 sm:p-3 overflow-hidden transition-opacity duration-200'
          : 'h-0 overflow-hidden opacity-0 pointer-events-none m-0 p-0 border-0'
      }
      aria-hidden={!isVisible}
    >
      {isVisible && (
        <div className="flex items-center justify-between gap-2 mb-1.5 px-1">
          <span className="text-[11px] font-mono text-[#264653]/55">Advertisement</span>
          <span className="text-[11px] font-mono text-[#264653]/45 truncate">
            {ad.provider}
          </span>
        </div>
      )}
      {!isFailed && (
        <SandboxedAdFrame
          ad={ad}
          placementId={placementId || ad.placementId}
          slotId={slotId}
          onStatusChange={handleStatus}
          onOutcomeChange={setOutcomeCategory}
          onResponseStatusChange={setResponseStatus}
        />
      )}
    </div>
  );
});
