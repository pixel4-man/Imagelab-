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
  name: string;
  provider: string;
  adType: AdType;
  scriptCode: string;
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

export function validateAdPayload(input: Partial<AdPayload>): {
  valid: boolean;
  error?: string;
  sanitized?: AdPayload;
} {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const provider = typeof input.provider === 'string' ? input.provider.trim() : '';
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

  if (name.length < 2 || name.length > 120) {
    return { valid: false, error: 'Advertisement name must be between 2 and 120 characters.' };
  }
  if (provider.length < 2 || provider.length > 80) {
    return { valid: false, error: 'Ad provider name must be between 2 and 80 characters.' };
  }
  if (!BUILT_IN_AD_TYPES.includes(adType)) {
    return { valid: false, error: 'Invalid advertisement type selected.' };
  }
  if (scriptCode.length < 5 || scriptCode.length > 50000) {
    return { valid: false, error: 'Advertisement script code must be between 5 and 50,000 characters.' };
  }
  if (!/^[a-zA-Z0-9_-]{2,128}$/.test(placementId)) {
    return {
      valid: false,
      error: 'Please select a saved website placement for this advertisement.',
    };
  }
  if (!/^(auto|\d+(px|%|vw)?)$/i.test(width) || width.length > 20) {
    return { valid: false, error: 'Ad width must be "auto" or a valid CSS dimension (e.g., 728px, 100%).' };
  }
  if (!/^(auto|\d+(px|%|vh)?)$/i.test(height) || height.length > 20) {
    return { valid: false, error: 'Ad height must be "auto" or a valid CSS dimension (e.g., 90px, 250px).' };
  }

  return {
    valid: true,
    sanitized: {
      name,
      provider,
      adType,
      scriptCode,
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
