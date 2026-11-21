import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import {
  AdZoneDiagnosticSnapshot,
  getAdDiagnosticSnapshots,
  isAdDebugQueryEnabled,
  subscribeAdDiagnostics,
} from '../lib/adDiagnostics';
import { copyTextWithFallback } from '../lib/clipboard';

function formatScriptEventLabel(event: AdZoneDiagnosticSnapshot['scriptEvent']): string {
  switch (event) {
    case 'load_fired':
      return 'load event fired';
    case 'error_fired':
      return 'error event fired';
    case 'pending':
      return 'pending (waiting for load/error)';
    default:
      return 'not started';
  }
}

function formatPlacementMountLabel(snap: AdZoneDiagnosticSnapshot): string {
  if (snap.placementMounted === 'yes') {
    return `Yes (${snap.mountReason || 'mounted'})`;
  }
  if (snap.placementMounted === 'skipped_viewport') {
    return `Skipped (${snap.mountReason || 'viewport mismatch'})`;
  }
  return `No (${snap.mountReason || 'not mounted'})`;
}

export function readWindowAdDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return isAdDebugQueryEnabled(window.location.pathname, window.location.search);
}

export function AdDebugPanel() {
  const location = useLocation();
  const [enabled, setEnabled] = useState<boolean>(() => readWindowAdDebugEnabled());
  const [snapshots, setSnapshots] = useState<AdZoneDiagnosticSnapshot[]>(() =>
    readWindowAdDebugEnabled() ? getAdDiagnosticSnapshots() : []
  );
  const [collapsed, setCollapsed] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState('');
  const [viewportInfo, setViewportInfo] = useState(() =>
    typeof window !== 'undefined'
      ? {
          width: window.innerWidth,
          height: window.innerHeight,
          isDesktop: window.matchMedia('(min-width: 1024px)').matches,
          origin: window.location.origin,
        }
      : { width: 0, height: 0, isDesktop: true, origin: '' }
  );

  useEffect(() => {
    const checkEnabled = () => {
      setEnabled(readWindowAdDebugEnabled());
    };
    checkEnabled();
    window.addEventListener('popstate', checkEnabled);
    return () => window.removeEventListener('popstate', checkEnabled);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!enabled) return;
    setSnapshots(getAdDiagnosticSnapshots());
    const unsub = subscribeAdDiagnostics(() => {
      setSnapshots(getAdDiagnosticSnapshots());
    });
    const rafId = window.requestAnimationFrame(() => {
      setSnapshots(getAdDiagnosticSnapshots());
    });
    const syncViewport = () => {
      setViewportInfo({
        width: window.innerWidth,
        height: window.innerHeight,
        isDesktop: window.matchMedia('(min-width: 1024px)').matches,
        origin: window.location.origin,
      });
    };
    syncViewport();
    window.addEventListener('resize', syncViewport);
    return () => {
      window.cancelAnimationFrame(rafId);
      unsub();
      window.removeEventListener('resize', syncViewport);
    };
  }, [enabled]);

  if (!enabled || typeof document === 'undefined') return null;

  const handleCopyJson = async () => {
    const payload = {
      capturedAt: new Date().toISOString(),
      origin: viewportInfo.origin,
      viewport: `${viewportInfo.width}x${viewportInfo.height} (${
        viewportInfo.isDesktop ? 'desktop >=1024px' : 'mobile <1024px'
      })`,
      sandboxPolicy: 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox',
      opaqueOrigin: true,
      zones: snapshots.map((z) => ({
        zoneNumber: z.zoneNumber,
        placementName: z.placementName,
        zoneKey: z.zoneKey,
        dimensions: z.dimensions,
        deviceTarget: z.deviceTarget,
        scriptUrl: z.scriptUrl,
        placementMounted: z.placementMounted,
        mountReason: z.mountReason,
        anchorFound: z.anchorFound,
        anchorSummary: z.anchorSummary,
        scriptElementCreated: z.scriptElementCreated,
        scriptEvent: z.scriptEvent,
        nestedIframeCreated: z.nestedIframeCreated,
        nestedIframeSrc: z.nestedIframeSrc || null,
        visibleCreativeDetected: z.visibleCreativeDetected,
        visibleCreativeDetail: z.visibleCreativeDetail || null,
        observedHttpStatus: z.observedHttpStatus || null,
        removedByCleanup: z.removedByCleanup,
        cleanupReason: z.cleanupReason || null,
        timedOut: z.timedOut,
        currentStatus: z.currentStatus,
        outcomeCategory: z.outcomeCategory || null,
        errorMessage: z.errorMessage || null,
        events: z.events,
      })),
    };
    const res = await copyTextWithFallback(JSON.stringify(payload, null, 2));
    setCopiedMsg(res.ok ? 'Copied JSON' : 'Copy blocked — select manually in console');
    window.setTimeout(() => setCopiedMsg(''), 3000);
  };

  return createPortal(
    <section
      id="imagelab-ad-debug-panel"
      data-cursor="hidden"
      aria-label="Production Adsterra Diagnostics"
      className="fixed bottom-3 right-3 left-3 sm:left-auto sm:w-[520px] max-w-[calc(100vw-1.5rem)] max-h-[80dvh] z-[2147483000] rounded-2xl bg-[#182B33] text-[#FAF7F2] border border-[#FAF7F2]/25 shadow-2xl flex flex-col overflow-hidden text-xs font-mono cursor-auto [&_button]:cursor-pointer"
    >
      <div className="px-3.5 py-2.5 bg-[#112027] border-b border-[#FAF7F2]/12 flex items-center justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <p className="font-bold text-[#E76F51] truncate">
            Adsterra Production Diagnostics (?addebug=1)
          </p>
          <p className="text-[10px] text-[#FAF7F2]/70 truncate">
            {viewportInfo.origin} · {viewportInfo.width}×{viewportInfo.height}px (
            {viewportInfo.isDesktop ? 'Desktop >=1024px' : 'Mobile <1024px'})
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleCopyJson}
            className="px-2.5 py-1.5 rounded bg-[#2A9D8F] hover:bg-[#218175] text-white text-[11px] font-semibold"
          >
            {copiedMsg || 'Copy JSON'}
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            className="px-2.5 py-1.5 rounded bg-[#FAF7F2]/14 hover:bg-[#FAF7F2]/24 text-[#FAF7F2] text-[11px] font-semibold"
          >
            {collapsed ? 'Expand' : 'Minimize'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="p-3 overflow-y-auto overscroll-contain space-y-2.5">
          <div className="p-2.5 rounded-xl bg-[#FAF7F2]/6 border border-[#FAF7F2]/10 text-[11px] leading-relaxed text-[#FAF7F2]/85">
            <div>
              <span className="text-[#FAF7F2]/55">Outer Sandbox:</span>{' '}
              <code>allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox</code>{' '}
              (opaque <code>about:srcdoc</code>, no <code>allow-same-origin</code>)
            </div>
            <div className="text-[#FAF7F2]/65 mt-1">
              HTTP statuses for cross-origin <code>&lt;script&gt;</code> tags without{' '}
              <code>Timing-Allow-Origin</code> are hidden by browsers; shown below only when
              reliably exposed by PerformanceResourceTiming.
            </div>
          </div>

          {snapshots.map((zone) => (
            <div
              key={zone.zoneKey}
              data-ad-debug-zone={zone.zoneKey}
              className="p-2.5 rounded-xl bg-[#FAF7F2]/6 border border-[#FAF7F2]/12 space-y-1"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-bold text-[#FAF7F2] truncate">
                    Zone {zone.zoneNumber}: {zone.placementName}
                  </p>
                  <p className="text-[10px] text-[#FAF7F2]/65 break-all">
                    ID: {zone.zoneKey} · {zone.dimensions} · target={zone.deviceTarget}
                  </p>
                </div>
                <span className="px-1.5 py-0.5 rounded bg-[#FAF7F2]/12 text-[10px] font-semibold shrink-0">
                  {zone.currentStatus}
                </span>
              </div>

              <dl className="grid grid-cols-1 gap-0.5 pt-1 text-[11px]">
                <div>
                  <dt className="inline text-[#FAF7F2]/60">Placement mounted: </dt>
                  <dd className="inline text-[#FAF7F2]">{formatPlacementMountLabel(zone)}</dd>
                </div>
                <div>
                  <dt className="inline text-[#FAF7F2]/60">DOM anchor: </dt>
                  <dd className="inline text-[#FAF7F2]">
                    {zone.anchorFound
                      ? `Found (${zone.anchorSummary})`
                      : `Missing (${zone.anchorSummary})`}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-[#FAF7F2]/60">Script element created: </dt>
                  <dd className="inline text-[#FAF7F2]">
                    {zone.scriptElementCreated ? 'Yes' : 'No'}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-[#FAF7F2]/60">Script load/error event: </dt>
                  <dd className="inline text-[#FAF7F2]">
                    {formatScriptEventLabel(zone.scriptEvent)}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-[#FAF7F2]/60">Nested iframe created: </dt>
                  <dd className="inline text-[#FAF7F2]">
                    {zone.nestedIframeCreated
                      ? `Yes (${zone.nestedIframeSrc || 'about:blank'})`
                      : 'No'}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-[#FAF7F2]/60">Visible creative detected: </dt>
                  <dd className="inline text-[#FAF7F2]">
                    {zone.visibleCreativeDetected
                      ? `Yes (${zone.visibleCreativeDetail})`
                      : zone.visibleCreativeDetail
                        ? `No — ${zone.visibleCreativeDetail}`
                        : 'No'}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-[#FAF7F2]/60">Available HTTP status: </dt>
                  <dd className="inline text-[#FAF7F2]">
                    {zone.observedHttpStatus ||
                      'Not exposed by browser (cross-origin opaque no-cors request)'}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-[#FAF7F2]/60">Removed by cleanup / timeout: </dt>
                  <dd className="inline text-[#FAF7F2]">
                    Cleanup: {zone.removedByCleanup ? `Yes (${zone.cleanupReason})` : 'No'} ·
                    Timeout: {zone.timedOut ? 'Yes' : 'No'}
                  </dd>
                </div>
                {zone.errorMessage && (
                  <div className="pt-0.5 text-[#F4A261] break-words">
                    <dt className="inline font-semibold">Error / Detail: </dt>
                    <dd className="inline">{zone.errorMessage}</dd>
                  </div>
                )}
              </dl>
            </div>
          ))}
        </div>
      )}
    </section>,
    document.body
  );
}
