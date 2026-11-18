import { useEffect, useMemo, useState } from 'react';
import { ActiveAdState, fetchPublicActiveAds } from '../lib/adsPersistence';
import { AdRecord, normalizePageRoute } from '../types/ads';

export const ADS_UPDATED_EVENT = 'imagelab-ads-updated';
export type { ActiveAdState };

let cachedActiveState: ActiveAdState | null = null;
let inflightStateRequest: Promise<ActiveAdState> | null = null;

export function notifyActiveAdsUpdated() {
  cachedActiveState = null;
  inflightStateRequest = null;
  window.dispatchEvent(new CustomEvent(ADS_UPDATED_EVENT));
}

// Queries /api/ads/active first, with active-only Firestore publicAdSlots fallback on static hosts
export async function fetchActiveAdState(): Promise<ActiveAdState> {
  if (cachedActiveState) return cachedActiveState;
  if (inflightStateRequest) return inflightStateRequest;

  inflightStateRequest = fetchPublicActiveAds()
    .then((next) => {
      cachedActiveState = next;
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

function buildSandboxedAdSrcDoc(ad: AdRecord): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: transparent;
    color: #264653;
    font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
    overflow-x: hidden;
  }
  .ad-root {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 56px;
  }
  img, iframe, ins {
    max-width: 100%;
  }
</style>
</head>
<body>
  <div class="ad-root" id="ad-root">${ad.scriptCode}</div>
  <script>
    (function () {
      function reportHeight() {
        var h = Math.max(
          document.body ? document.body.scrollHeight : 0,
          document.documentElement ? document.documentElement.scrollHeight : 0
        );
        if (window.parent && h > 0) {
          window.parent.postMessage({ type: 'imagelab-ad-resize', id: ${JSON.stringify(ad.id)}, height: h }, '*');
        }
      }
      window.addEventListener('load', reportHeight);
      setTimeout(reportHeight, 120);
      setTimeout(reportHeight, 600);
      if (typeof ResizeObserver !== 'undefined' && document.body) {
        new ResizeObserver(reportHeight).observe(document.body);
      }
    })();
  </script>
</body>
</html>`;
}

export function SandboxedAdFrame({ ad }: { ad: AdRecord }) {
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
      return;
    }

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; id?: string; height?: number } | null;
      if (
        data &&
        data.type === 'imagelab-ad-resize' &&
        data.id === ad.id &&
        typeof data.height === 'number' &&
        data.height >= 40 &&
        data.height <= 900
      ) {
        setAutoHeight(Math.ceil(data.height));
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

  return (
    <iframe
      title={`Sponsored: ${ad.name}`}
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      loading="lazy"
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
  if (!adOverride) return null;

  return (
    <aside
      aria-label="Advertisement"
      data-ad-placement-id={placementId || adOverride.placementId}
      data-ad-test-mode={testMode ? 'true' : 'false'}
      className={`w-full ${className}`}
    >
      <div className="rounded-2xl bg-[#FAF7F2]/92 border border-[#264653]/12 p-3 sm:p-4 overflow-hidden">
        <div className="flex items-center justify-between gap-2 mb-2 px-1">
          <span className="text-[11px] font-mono text-[#264653]/55">
            {testMode
              ? `Preview Test Mode · Impressions Disabled${placementName ? ` · ${placementName}` : ''}`
              : 'Advertisement'}
          </span>
          <span className="text-[11px] font-mono text-[#264653]/45 truncate">
            {adOverride.provider}
          </span>
        </div>
        <SandboxedAdFrame ad={adOverride} />
      </div>
    </aside>
  );
}
