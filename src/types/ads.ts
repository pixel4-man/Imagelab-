export const AD_TYPES = [
  { value: 'banner', label: 'Banner' },
  { value: 'responsive_banner', label: 'Responsive Banner' },
  { value: 'native_ad', label: 'Native Ad' },
  { value: 'popunder', label: 'Popunder' },
  { value: 'custom_html_js', label: 'Custom HTML / JavaScript' },
  { value: 'other', label: 'Other' },
] as const;

export type AdType = (typeof AD_TYPES)[number]['value'];

export type AdStatus = 'active' | 'disabled';
export type AdInsertPosition = 'before' | 'after' | 'inside';

export const DIMENSION_PRESETS = [
  { key: 'responsive', label: 'Responsive (auto × auto)', width: 'auto', height: 'auto' },
  { key: 'leaderboard', label: 'Leaderboard (728px × 90px)', width: '728px', height: '90px' },
  { key: 'medium_rect', label: 'Medium Rectangle (300px × 250px)', width: '300px', height: '250px' },
  { key: 'mobile_banner', label: 'Mobile Banner (320px × 50px)', width: '320px', height: '50px' },
  { key: 'large_leaderboard', label: 'Large Banner (970px × 90px)', width: '970px', height: '90px' },
  { key: 'skyscraper', label: 'Wide Skyscraper (160px × 600px)', width: '160px', height: '600px' },
] as const;

export interface VisualPlacementRecord {
  id: string;
  name: string;
  pageRoute: string;
  slotId: string;
  selector: string;
  elementInfo: string;
  position: AdInsertPosition;
  width: string;
  height: string;
  adType: AdType;
  status: AdStatus;
  priority: number;
  anchorMissing?: boolean;
  createdByUid: string;
  createdAt: string;
  updatedAt: string;
}

export interface VisualPlacementPayload {
  name: string;
  pageRoute: string;
  slotId: string;
  selector: string;
  elementInfo: string;
  position: AdInsertPosition;
  width?: string;
  height?: string;
  adType?: AdType;
  status: AdStatus;
  priority: number;
}

export interface AdRecord {
  id: string;
  name: string;
  provider: string;
  adType: AdType;
  scriptCode: string;
  destinationUrl?: string;
  placementId: string;
  placementName?: string;
  width: string;
  height: string;
  status: AdStatus;
  priority: number;
  createdAt: string;
  updatedAt: string;
  updatedByUid?: string;
}

export interface AdPayload {
  name?: string;
  provider?: string;
  adType: AdType;
  scriptCode: string;
  destinationUrl?: string;
  placementId: string;
  width: string;
  height: string;
  status: AdStatus;
  priority: number;
}

export const BUILT_IN_AD_TYPES = AD_TYPES.map((t) => t.value);

export function getAdTypeLabel(adType: AdType): string {
  return AD_TYPES.find((t) => t.value === adType)?.label || adType;
}

export function normalizeSlotIdentifier(raw?: string): string {
  if (!raw) return '';
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

export function normalizePageRoute(raw?: string): string {
  if (!raw || typeof raw !== 'string') return '/';
  const cleaned = raw.split('?')[0].split('#')[0].trim();
  if (!cleaned.startsWith('/')) return `/${cleaned}`.slice(0, 200);
  if (cleaned.length > 1 && cleaned.endsWith('/')) return cleaned.slice(0, -1).slice(0, 200);
  return cleaned.slice(0, 200) || '/';
}

export function validateSafeHttpUrl(raw?: string): {
  valid: boolean;
  sanitized: string;
  error?: string;
} {
  if (raw === undefined || raw === null) {
    return { valid: true, sanitized: '' };
  }
  if (typeof raw !== 'string') {
    return { valid: false, sanitized: '', error: 'Destination URL must be text.' };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: true, sanitized: '' };
  }
  if (trimmed.length > 2000) {
    return { valid: false, sanitized: '', error: 'Destination URL must be 2,000 characters or fewer.' };
  }
  // Reject control characters or whitespace inside URL
  if (/[\u0000-\u001F\u007F\s]/.test(trimmed)) {
    return {
      valid: false,
      sanitized: '',
      error: 'Destination URL cannot contain spaces or control characters.',
    };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        valid: false,
        sanitized: '',
        error: 'Destination URL must start with http:// or https://.',
      };
    }
    if (!parsed.hostname) {
      return { valid: false, sanitized: '', error: 'Destination URL must include a valid domain.' };
    }
    return { valid: true, sanitized: parsed.toString() };
  } catch {
    return {
      valid: false,
      sanitized: '',
      error: 'Destination URL must be a valid http:// or https:// URL.',
    };
  }
}

export function detectAdProvider(scriptCode: string): string {
  const code = (scriptCode || '').toLowerCase();
  if (!code.trim()) return 'Custom Ad';

  if (
    code.includes('adsterra') ||
    code.includes('highperformanceformat') ||
    code.includes('effectivegatecpm') ||
    code.includes('effectivecreativeformat') ||
    code.includes('profitabledisplaynetwork') ||
    code.includes('profitabledisplayformat') ||
    code.includes('profitablecpmrate') ||
    code.includes('topcreativeformat') ||
    code.includes('toprevenuegate') ||
    /\batoptions\b/.test(code)
  ) {
    return 'Adsterra';
  }
  if (
    code.includes('googlesyndication') ||
    code.includes('adsbygoogle') ||
    code.includes('doubleclick.net') ||
    code.includes('googletagservices')
  ) {
    return 'Google AdSense';
  }
  if (code.includes('monetag') || code.includes('alwingulla') || code.includes('thaudray')) {
    return 'Monetag';
  }
  if (code.includes('propellerads') || code.includes('propeller')) {
    return 'PropellerAds';
  }
  if (code.includes('media.net')) {
    return 'Media.net';
  }
  if (code.includes('mgid.com') || code.includes('jsc.mgid')) {
    return 'MGID';
  }
  if (code.includes('ezoic') || code.includes('ezstandalone')) {
    return 'Ezoic';
  }
  if (code.includes('revcontent')) {
    return 'Revcontent';
  }
  if (code.includes('amazon-adsystem')) {
    return 'Amazon Ads';
  }
  if (/<script\b/i.test(code)) {
    return 'Generic Ad Network';
  }
  if (/<img\b/i.test(code) || /^https?:\/\/\S+\.(png|jpe?g|webp|gif|svg)(\?\S*)?$/i.test(code.trim())) {
    return 'Custom Banner';
  }
  return 'Custom Ad';
}

export interface AtOptionsMetadata {
  key?: string;
  format?: string;
  width?: string;
  height?: string;
}

/**
 * Safely extracts configured width, height, format, and zone key from Adsterra `atOptions` snippets
 * without executing arbitrary JavaScript.
 */
export function extractAtOptionsMetadata(scriptCode: string): AtOptionsMetadata {
  const code = scriptCode || '';
  if (!/\batOptions\b/i.test(code)) return {};

  const blockMatch = code.match(/\batOptions\s*=\s*\{([\s\S]*?)\}/);
  const target = blockMatch ? blockMatch[1] : code;

  const widthMatch = target.match(/['"]?width['"]?\s*:\s*['"]?(\d{2,4})['"]?/i);
  const heightMatch = target.match(/['"]?height['"]?\s*:\s*['"]?(\d{2,4})['"]?/i);
  const formatMatch = target.match(/['"]?format['"]?\s*:\s*['"]([a-zA-Z0-9_-]+)['"]/i);
  const keyMatch = target.match(/['"]?key['"]?\s*:\s*['"]([a-zA-Z0-9_-]{8,64})['"]/i);

  const widthNum = widthMatch ? parseInt(widthMatch[1], 10) : NaN;
  const heightNum = heightMatch ? parseInt(heightMatch[1], 10) : NaN;

  return {
    key: keyMatch ? keyMatch[1] : undefined,
    format: formatMatch ? formatMatch[1].toLowerCase() : undefined,
    width: Number.isFinite(widthNum) && widthNum > 0 && widthNum <= 2500 ? `${widthNum}px` : undefined,
    height: Number.isFinite(heightNum) && heightNum > 0 && heightNum <= 2500 ? `${heightNum}px` : undefined,
  };
}

export function deriveInternalAdName(params: {
  adType: AdType;
  provider?: string;
  placementName?: string;
  scriptCode?: string;
}): string {
  const provider = (params.provider || detectAdProvider(params.scriptCode || '')).trim() || 'Custom Ad';
  const typeLabel = getAdTypeLabel(params.adType);
  const place = (params.placementName || '').trim();
  const base = place ? `${provider} · ${place}` : `${provider} · ${typeLabel}`;
  return base.slice(0, 120);
}

/**
 * Returns true when the submitted snippet already contains interactive links,
 * buttons, frames, or third-party scripts whose own click behavior must NOT
 * be wrapped or intercepted by an outer Destination URL link.
 */
export function hasOwnInteractiveOrScriptElements(scriptCode: string): boolean {
  const code = (scriptCode || '').trim();
  if (!code) return false;
  return /(<script\b|<a\b|\bhref\s*=|<button\b|<iframe\b|<area\b|<form\b|\bonclick\s*=|\batoptions\b|\badsbygoogle\b)/i.test(
    code
  );
}

/**
 * Normalizes direct safe HTTP/HTTPS image URLs pasted as creative code into an <img> tag,
 * while preserving full HTML/script snippets untouched.
 */
export function normalizeCreativeMarkup(scriptCode: string): string {
  const trimmed = (scriptCode || '').trim();
  if (!trimmed) return '';
  if (!trimmed.includes('<') && /^https?:\/\/\S+$/i.test(trimmed)) {
    const safeImg = validateSafeHttpUrl(trimmed);
    if (safeImg.valid && safeImg.sanitized) {
      const escaped = safeImg.sanitized
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<img src="${escaped}" alt="Advertisement" style="max-width:100%;height:auto;display:block;margin:0 auto;border-radius:10px;" />`;
    }
  }
  return trimmed;
}

export function findDuplicatePlacement<
  T extends { id: string; name: string; pageRoute: string; slotId: string; selector: string; position: AdInsertPosition }
>(
  candidate: {
    pageRoute: string;
    slotId: string;
    selector: string;
    position: AdInsertPosition;
  },
  existingList: T[],
  excludeId?: string
): T | null {
  const targetRoute = normalizePageRoute(candidate.pageRoute);
  const targetSlot = normalizeSlotIdentifier(candidate.slotId);
  const targetSelector = candidate.selector.trim();

  for (const item of existingList) {
    if (excludeId && item.id === excludeId) continue;
    const itemRoute = normalizePageRoute(item.pageRoute);
    const itemSlot = normalizeSlotIdentifier(item.slotId);
    const itemSelector = (item.selector || '').trim();
    if (itemRoute !== targetRoute || item.position !== candidate.position) {
      continue;
    }
    if ((targetSlot && itemSlot === targetSlot) || (targetSelector && itemSelector === targetSelector)) {
      return item;
    }
  }
  return null;
}

export function validatePlacementPayload(input: Partial<VisualPlacementPayload>): {
  valid: boolean;
  error?: string;
  sanitized?: Required<VisualPlacementPayload>;
} {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const pageRoute = normalizePageRoute(input.pageRoute);
  const slotId = normalizeSlotIdentifier(input.slotId);
  const selector = typeof input.selector === 'string' ? input.selector.trim().slice(0, 400) : '';
  const elementInfo =
    typeof input.elementInfo === 'string' ? input.elementInfo.trim().slice(0, 200) : '';
  const position: AdInsertPosition =
    input.position === 'before' || input.position === 'inside' ? input.position : 'after';
  const width =
    typeof input.width === 'string' && input.width.trim() ? input.width.trim() : 'auto';
  const height =
    typeof input.height === 'string' && input.height.trim() ? input.height.trim() : 'auto';
  const rawAdType = input.adType as AdType | undefined;
  const adType: AdType =
    rawAdType && BUILT_IN_AD_TYPES.includes(rawAdType) ? rawAdType : 'responsive_banner';
  const status: AdStatus = input.status === 'disabled' ? 'disabled' : 'active';
  const priorityNum = Number(input.priority);
  const priority = Number.isFinite(priorityNum)
    ? Math.max(1, Math.min(999, Math.round(priorityNum)))
    : 10;

  if (name.length < 2 || name.length > 120) {
    return { valid: false, error: 'Placement name must be between 2 and 120 characters.' };
  }
  if (!pageRoute || pageRoute.length > 200) {
    return { valid: false, error: 'A valid page route is required.' };
  }
  if (slotId.length < 2) {
    return { valid: false, error: 'A valid placement slot identifier is required.' };
  }
  if (selector.length < 2) {
    return { valid: false, error: 'A valid CSS selector or anchor reference is required.' };
  }
  if (elementInfo.length < 2) {
    return { valid: false, error: 'Element description is required.' };
  }
  if (!/^(auto|\d+(px|%|vw)?)$/i.test(width) || width.length > 20) {
    return {
      valid: false,
      error: 'Placement width must be "auto" or a valid CSS dimension (e.g., 728px, 100%).',
    };
  }
  if (!/^(auto|\d+(px|%|vh)?)$/i.test(height) || height.length > 20) {
    return {
      valid: false,
      error: 'Placement height must be "auto" or a valid CSS dimension (e.g., 90px, 250px).',
    };
  }
  if (rawAdType !== undefined && !BUILT_IN_AD_TYPES.includes(rawAdType)) {
    return { valid: false, error: 'Invalid placement ad type selected.' };
  }

  return {
    valid: true,
    sanitized: {
      name,
      pageRoute,
      slotId,
      selector,
      elementInfo,
      position,
      width,
      height,
      adType,
      status,
      priority,
    },
  };
}

export function validateAdPayload(
  input: Partial<AdPayload>,
  options?: { placementName?: string }
): {
  valid: boolean;
  error?: string;
  sanitized?: {
    name: string;
    provider: string;
    adType: AdType;
    scriptCode: string;
    destinationUrl: string;
    placementId: string;
    width: string;
    height: string;
    status: AdStatus;
    priority: number;
  };
} {
  const adType = input.adType as AdType;
  const scriptCode = typeof input.scriptCode === 'string' ? input.scriptCode.trim() : '';
  const placementId = typeof input.placementId === 'string' ? input.placementId.trim() : '';
  const width = typeof input.width === 'string' && input.width.trim() ? input.width.trim() : 'auto';
  const height = typeof input.height === 'string' && input.height.trim() ? input.height.trim() : 'auto';
  const status: AdStatus = input.status === 'disabled' ? 'disabled' : 'active';
  const priorityNum = Number(input.priority);
  const priority = Number.isFinite(priorityNum)
    ? Math.max(1, Math.min(999, Math.round(priorityNum)))
    : 10;

  if (!BUILT_IN_AD_TYPES.includes(adType)) {
    return { valid: false, error: 'Invalid advertisement type selected.' };
  }
  if (scriptCode.length < 5 || scriptCode.length > 50000) {
    return {
      valid: false,
      error: 'Advertisement script code must be between 5 and 50,000 characters.',
    };
  }

  const destCheck = validateSafeHttpUrl(input.destinationUrl);
  if (!destCheck.valid) {
    return { valid: false, error: destCheck.error || 'Invalid Destination URL.' };
  }

  if (!/^[a-zA-Z0-9_-]{2,128}$/.test(placementId)) {
    return {
      valid: false,
      error: 'Please select a saved website placement for this advertisement.',
    };
  }
  if (!/^(auto|\d+(px|%|vw)?)$/i.test(width) || width.length > 20) {
    return {
      valid: false,
      error: 'Ad width must be "auto" or a valid CSS dimension (e.g., 728px, 100%).',
    };
  }
  if (!/^(auto|\d+(px|%|vh)?)$/i.test(height) || height.length > 20) {
    return {
      valid: false,
      error: 'Ad height must be "auto" or a valid CSS dimension (e.g., 90px, 250px).',
    };
  }

  const rawProvider = typeof input.provider === 'string' ? input.provider.trim() : '';
  const provider = (rawProvider.length >= 2 ? rawProvider : detectAdProvider(scriptCode)).slice(0, 80);

  const rawName = typeof input.name === 'string' ? input.name.trim() : '';
  const name = (
    rawName.length >= 2
      ? rawName
      : deriveInternalAdName({
          adType,
          provider,
          placementName: options?.placementName,
          scriptCode,
        })
  ).slice(0, 120);

  return {
    valid: true,
    sanitized: {
      name,
      provider,
      adType,
      scriptCode,
      destinationUrl: destCheck.sanitized,
      placementId,
      width,
      height,
      status,
      priority,
    },
  };
}

export function formatReadableError(error: unknown, fallback = 'Operation failed.'): string {
  const raw = error instanceof Error ? error.message : String(error || '');
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  if (trimmed.startsWith('{') && trimmed.includes('"error"')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        error?: string;
        operationType?: string;
        path?: string | null;
      };
      if (parsed.error) {
        const ctx =
          parsed.operationType && parsed.path
            ? ` (${parsed.operationType} ${parsed.path})`
            : '';
        return `${parsed.error}${ctx}`;
      }
    } catch {
      // Keep original message
    }
  }
  return trimmed;
}
