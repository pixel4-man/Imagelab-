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

export const BUILT_IN_AD_TYPES = AD_TYPES.map((t) => t.value);

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
  createdAt: string;
  updatedAt: string;
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
  customPlacementKey?: string;
  width: string;
  height: string;
  status: AdStatus;
  priority: number;
  createdAt: string;
  updatedAt: string;
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
  const trimmed = raw.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').trim();
  if (!trimmed) {
    return { valid: true, sanitized: '' };
  }
  if (trimmed.length > 2000) {
    return { valid: false, sanitized: '', error: 'Destination URL must be 2,000 characters or fewer.' };
  }
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
    code.includes('bicea.org') ||
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
