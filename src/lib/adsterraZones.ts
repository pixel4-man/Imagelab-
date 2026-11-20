import { AdRecord, VisualPlacementRecord, extractAtOptionsMetadata } from '../types/ads';

export type AdDeviceTarget = 'desktop' | 'mobile' | 'all';

export interface AutomaticAdsterraZoneDefinition {
  zoneNumber: 1 | 2 | 3 | 4 | 5;
  id: string;
  zoneKey: string;
  scriptUrl: string;
  widthPx: number;
  heightPx: number;
  width: string;
  height: string;
  defaultPlacementId: string;
  defaultPlacementName: string;
  deviceTarget: AdDeviceTarget;
  title: string;
  description: string;
}

export const BUILTIN_AD_PLACEMENTS: VisualPlacementRecord[] = [
  {
    id: 'plc_builtin_desktop_header_banner',
    name: 'Desktop Header Banner (468×60)',
    pageRoute: '*',
    slotId: 'desktop_header_banner',
    selector: '[data-ad-slot="desktop_header_banner"]',
    elementInfo: 'Desktop Header Banner Area (<div data-ad-slot="desktop_header_banner">)',
    position: 'inside',
    width: '468px',
    height: '60px',
    adType: 'banner',
    status: 'active',
    priority: 1,
    createdAt: '2026-11-19T00:00:00.000Z',
    updatedAt: '2026-11-19T00:00:00.000Z',
  },
  {
    id: 'plc_builtin_mobile_header_banner',
    name: 'Mobile Header Banner (320×50)',
    pageRoute: '*',
    slotId: 'mobile_header_banner',
    selector: '[data-ad-slot="mobile_header_banner"]',
    elementInfo: 'Mobile Header Banner Area (<div data-ad-slot="mobile_header_banner">)',
    position: 'inside',
    width: '320px',
    height: '50px',
    adType: 'banner',
    status: 'active',
    priority: 2,
    createdAt: '2026-11-19T00:00:00.000Z',
    updatedAt: '2026-11-19T00:00:00.000Z',
  },
  {
    id: 'plc_builtin_desktop_homepage_banner',
    name: 'Desktop Homepage Banner (728×90)',
    pageRoute: '/',
    slotId: 'desktop_homepage_banner',
    selector: '[data-ad-slot="desktop_homepage_banner"]',
    elementInfo: 'Desktop Homepage Banner (<div data-ad-slot="desktop_homepage_banner">)',
    position: 'inside',
    width: '728px',
    height: '90px',
    adType: 'banner',
    status: 'active',
    priority: 3,
    createdAt: '2026-11-19T00:00:00.000Z',
    updatedAt: '2026-11-19T00:00:00.000Z',
  },
  {
    id: 'plc_builtin_homepage_gallery_banner',
    name: 'Homepage Content / Gallery Banner (300×250)',
    pageRoute: '/',
    slotId: 'homepage_gallery_banner',
    selector: '[data-ad-slot="homepage_gallery_banner"]',
    elementInfo: 'Homepage Content / Gallery Banner (<div data-ad-slot="homepage_gallery_banner">)',
    position: 'inside',
    width: '300px',
    height: '250px',
    adType: 'banner',
    status: 'active',
    priority: 4,
    createdAt: '2026-11-19T00:00:00.000Z',
    updatedAt: '2026-11-19T00:00:00.000Z',
  },
  {
    id: 'plc_builtin_desktop_sidebar_banner',
    name: 'Desktop Sidebar Banner (160×600)',
    pageRoute: '*',
    slotId: 'desktop_sidebar_banner',
    selector: '[data-ad-slot="desktop_sidebar_banner"]',
    elementInfo: 'Desktop Sidebar Banner Rail (<aside data-ad-slot="desktop_sidebar_banner">)',
    position: 'inside',
    width: '160px',
    height: '600px',
    adType: 'banner',
    status: 'active',
    priority: 5,
    createdAt: '2026-11-19T00:00:00.000Z',
    updatedAt: '2026-11-19T00:00:00.000Z',
  },
];

export const BUILTIN_AD_PLACEMENTS_BY_ID = new Map<string, VisualPlacementRecord>(
  BUILTIN_AD_PLACEMENTS.map((p) => [p.id, p])
);

/**
 * Exact 5 supplied Adsterra ad zones with immutable zone IDs and script URLs.
 */
export const ADSTERRA_ZONES: AutomaticAdsterraZoneDefinition[] = [
  {
    zoneNumber: 1,
    id: 'adsterra_zone_9bf275cec2fca23dd811c4ea8b659006',
    zoneKey: '9bf275cec2fca23dd811c4ea8b659006',
    scriptUrl: 'https://bicea.org/22/9bf275cec2fca23dd811c4ea8b659006',
    widthPx: 468,
    heightPx: 60,
    width: '468px',
    height: '60px',
    defaultPlacementId: 'plc_builtin_desktop_header_banner',
    defaultPlacementName: 'Desktop Header Banner (468×60)',
    deviceTarget: 'desktop',
    title: 'Zone 1 · Desktop Header Banner',
    description: '468 × 60 horizontal banner displayed in the desktop header slot (≥1024px).',
  },
  {
    zoneNumber: 2,
    id: 'adsterra_zone_8f006a55a574a4657b9c0b877e503a54',
    zoneKey: '8f006a55a574a4657b9c0b877e503a54',
    scriptUrl: 'https://bicea.org/22/8f006a55a574a4657b9c0b877e503a54',
    widthPx: 728,
    heightPx: 90,
    width: '728px',
    height: '90px',
    defaultPlacementId: 'plc_builtin_desktop_homepage_banner',
    defaultPlacementName: 'Desktop Homepage Banner (728×90)',
    deviceTarget: 'desktop',
    title: 'Zone 2 · Desktop Homepage Banner',
    description: '728 × 90 leaderboard displayed below the homepage hero on desktop viewports.',
  },
  {
    zoneNumber: 3,
    id: 'adsterra_zone_1c30969d7c004ca503ae6460010eb760',
    zoneKey: '1c30969d7c004ca503ae6460010eb760',
    scriptUrl: 'https://bicea.org/22/1c30969d7c004ca503ae6460010eb760',
    widthPx: 320,
    heightPx: 50,
    width: '320px',
    height: '50px',
    defaultPlacementId: 'plc_builtin_mobile_header_banner',
    defaultPlacementName: 'Mobile Header Banner (320×50)',
    deviceTarget: 'mobile',
    title: 'Zone 3 · Mobile Header Banner',
    description: '320 × 50 mobile banner mounted exclusively on mobile/tablet viewports (<1024px).',
  },
  {
    zoneNumber: 4,
    id: 'adsterra_zone_4606ed44271ecec8b5f053ee87806f78',
    zoneKey: '4606ed44271ecec8b5f053ee87806f78',
    scriptUrl: 'https://bicea.org/22/4606ed44271ecec8b5f053ee87806f78',
    widthPx: 160,
    heightPx: 600,
    width: '160px',
    height: '600px',
    defaultPlacementId: 'plc_builtin_desktop_sidebar_banner',
    defaultPlacementName: 'Desktop Sidebar Banner (160×600)',
    deviceTarget: 'desktop',
    title: 'Zone 4 · Desktop Sidebar Banner',
    description: '160 × 600 skyscraper sidebar banner mounted exclusively beside desktop galleries.',
  },
  {
    zoneNumber: 5,
    id: 'adsterra_zone_873ad292a31a1a1dee93fce99c7c7ff0',
    zoneKey: '873ad292a31a1a1dee93fce99c7c7ff0',
    scriptUrl: 'https://bicea.org/22/873ad292a31a1a1dee93fce99c7c7ff0',
    widthPx: 300,
    heightPx: 250,
    width: '300px',
    height: '250px',
    defaultPlacementId: 'plc_builtin_homepage_gallery_banner',
    defaultPlacementName: 'Homepage Content / Gallery Banner (300×250)',
    deviceTarget: 'all',
    title: 'Zone 5 · Homepage Content / Gallery Banner',
    description: '300 × 250 medium rectangle banner placed between homepage content sections.',
  },
];

export const ADSTERRA_ZONES_BY_ID = new Map<string, AutomaticAdsterraZoneDefinition>(
  ADSTERRA_ZONES.map((z) => [z.id, z])
);

export const ADSTERRA_ZONES_BY_KEY = new Map<string, AutomaticAdsterraZoneDefinition>(
  ADSTERRA_ZONES.map((z) => [z.zoneKey, z])
);

/**
 * Generates an independent Adsterra invocation snippet for a single zone.
 * Executed strictly inside its own isolated sandboxed iframe so `atOptions`
 * never collides across simultaneously mounted zones or leaks into the main app DOM.
 */
export function buildAdsterraZoneScript(zone: AutomaticAdsterraZoneDefinition): string {
  return [
    '<script>',
    `  atOptions = {`,
    `    'key' : '${zone.zoneKey}',`,
    `    'format' : 'iframe',`,
    `    'height' : ${zone.heightPx},`,
    `    'width' : ${zone.widthPx},`,
    `    'params' : {}`,
    '  };',
    '</script>',
    `<script src="${zone.scriptUrl}"></script>`,
  ].join('\n');
}

export function buildDefaultAdsterraAdRecord(
  zone: AutomaticAdsterraZoneDefinition
): AdRecord {
  return {
    id: zone.id,
    name: `Adsterra Zone ${zone.zoneNumber} · ${zone.defaultPlacementName}`,
    provider: 'Adsterra',
    adType: 'banner',
    scriptCode: buildAdsterraZoneScript(zone),
    destinationUrl: '',
    placementId: zone.defaultPlacementId,
    placementName: zone.defaultPlacementName,
    customPlacementKey: zone.zoneKey,
    width: zone.width,
    height: zone.height,
    status: 'active',
    priority: zone.zoneNumber,
    createdAt: '2026-11-19T00:00:00.000Z',
    updatedAt: '2026-11-19T00:00:00.000Z',
  };
}

export function extractAdsterraZoneKey(
  ad: Pick<AdRecord, 'id' | 'scriptCode' | 'customPlacementKey'>
): string | null {
  if (ad.customPlacementKey && /^[a-f0-9]{16,64}$/i.test(ad.customPlacementKey)) {
    return ad.customPlacementKey;
  }
  if (ad.id.startsWith('adsterra_zone_')) {
    return ad.id.slice('adsterra_zone_'.length);
  }
  const meta = extractAtOptionsMetadata(ad.scriptCode || '');
  if (meta.key) return meta.key;
  const biceaMatch = (ad.scriptCode || '').match(/bicea\.org\/\d+\/([a-f0-9]{16,64})/i);
  return biceaMatch ? biceaMatch[1] : null;
}

export function getPlacementDeviceTarget(
  placement: Pick<VisualPlacementRecord, 'slotId' | 'width'>,
  adsForPlacement: Array<Pick<AdRecord, 'id' | 'width' | 'customPlacementKey' | 'scriptCode'>> = []
): AdDeviceTarget {
  const slot = (placement.slotId || '').toLowerCase();
  if (slot.startsWith('desktop_')) return 'desktop';
  if (slot.startsWith('mobile_')) return 'mobile';

  for (const ad of adsForPlacement) {
    const key = extractAdsterraZoneKey(ad);
    if (key) {
      const matched = ADSTERRA_ZONES_BY_KEY.get(key);
      if (matched) return matched.deviceTarget;
    }
  }

  const wMatch = String(placement.width || '').match(/^(\d+)/);
  if (wMatch) {
    const wPx = parseInt(wMatch[1], 10);
    if (wPx >= 460) return 'desktop';
  }
  return 'all';
}

/**
 * Returns the static predefined 5 placements and 5 independent Adsterra zone definitions
 * directly from source code with zero Firestore or Ads Manager dependencies.
 */
export function getBuiltinAdsterraState(): {
  placements: VisualPlacementRecord[];
  ads: AdRecord[];
} {
  return {
    placements: [...BUILTIN_AD_PLACEMENTS].sort((a, b) => a.priority - b.priority),
    ads: ADSTERRA_ZONES.map((zone) => buildDefaultAdsterraAdRecord(zone)),
  };
}
