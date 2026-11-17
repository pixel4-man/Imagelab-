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

export interface VisualPlacementRecord {
  id: string;
  name: string;
  pageRoute: string;
  slotId: string;
  selector: string;
  elementInfo: string;
  position: AdInsertPosition;
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

export function validatePlacementPayload(input: Partial<VisualPlacementPayload>): {
  valid: boolean;
  error?: string;
  sanitized?: VisualPlacementPayload;
} {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const pageRoute = normalizePageRoute(input.pageRoute);
  const slotId = normalizeSlotIdentifier(input.slotId);
  const selector = typeof input.selector === 'string' ? input.selector.trim().slice(0, 400) : '';
  const elementInfo =
    typeof input.elementInfo === 'string' ? input.elementInfo.trim().slice(0, 200) : '';
  const position: AdInsertPosition =
    input.position === 'before' || input.position === 'inside' ? input.position : 'after';
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

  return {
    valid: true,
    sanitized: {
      name,
      pageRoute,
      slotId,
      selector,
      elementInfo,
      position,
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
