import { useEffect } from 'react';

const DEFAULT_PRODUCTION_ORIGIN = 'https://imagelab.imagemart.workers.dev';
const DEFAULT_IMAGE_PATH = '/src/assets/images/hero_architectural_atrium_1794836298275.jpg';

export interface SeoHeadProps {
  title: string;
  description: string;
  canonicalPath: string;
  noindex?: boolean;
  ogType?: 'website' | 'article';
  imageUrl?: string;
  structuredData?: Record<string, unknown> | Record<string, unknown>[];
}

export function resolveCanonicalOrigin(): string {
  const envUrl =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_SITE_URL
      ? String(import.meta.env.VITE_SITE_URL).trim().replace(/\/+$/, '')
      : '';
  if (envUrl && /^https?:\/\/[a-zA-Z0-9.-]+(:\d+)?$/i.test(envUrl)) {
    return envUrl;
  }
  if (typeof window !== 'undefined') {
    const host = window.location.hostname.toLowerCase();
    if (host.endsWith('.workers.dev') || host.endsWith('.pages.dev')) {
      return window.location.origin.replace(/\/+$/, '');
    }
  }
  return DEFAULT_PRODUCTION_ORIGIN;
}

export function resolveAbsoluteUrl(origin: string, rawPathOrUrl: string): string {
  const trimmed = (rawPathOrUrl || '').trim();
  if (!trimmed) return `${origin}/`;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('data:')) return `${origin}${DEFAULT_IMAGE_PATH}`;
  const cleanPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${origin}${cleanPath}`;
}

function upsertMetaTag(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertCanonicalLink(href: string) {
  let el = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

export function SeoHead({
  title,
  description,
  canonicalPath,
  noindex = false,
  ogType = 'website',
  imageUrl = DEFAULT_IMAGE_PATH,
  structuredData,
}: SeoHeadProps) {
  const serializedSchema = structuredData ? JSON.stringify(structuredData) : '';

  useEffect(() => {
    const origin = resolveCanonicalOrigin();
    const normalizedPath = canonicalPath === '/'
      ? '/'
      : `/${canonicalPath.replace(/^\/+/, '').replace(/\/+$/, '')}`;
    const canonicalUrl = `${origin}${normalizedPath}`;
    const resolvedImage = resolveAbsoluteUrl(origin, imageUrl);
    const robotsValue = noindex ? 'noindex, nofollow' : 'index, follow';

    document.title = title;
    upsertMetaTag('name', 'description', description);
    upsertMetaTag('name', 'robots', robotsValue);
    upsertCanonicalLink(canonicalUrl);

    upsertMetaTag('property', 'og:site_name', 'ImageLab');
    upsertMetaTag('property', 'og:type', ogType);
    upsertMetaTag('property', 'og:title', title);
    upsertMetaTag('property', 'og:description', description);
    upsertMetaTag('property', 'og:url', canonicalUrl);
    upsertMetaTag('property', 'og:image', resolvedImage);

    upsertMetaTag('name', 'twitter:card', 'summary_large_image');
    upsertMetaTag('name', 'twitter:title', title);
    upsertMetaTag('name', 'twitter:description', description);
    upsertMetaTag('name', 'twitter:image', resolvedImage);

    const scriptId = 'imagelab-route-jsonld';
    const existingScript = document.getElementById(scriptId);
    if (serializedSchema && !noindex) {
      const script = existingScript || document.createElement('script');
      script.id = scriptId;
      script.setAttribute('type', 'application/ld+json');
      script.textContent = serializedSchema;
      if (!existingScript) {
        document.head.appendChild(script);
      }
    } else if (existingScript) {
      existingScript.remove();
    }
  }, [title, description, canonicalPath, noindex, ogType, imageUrl, serializedSchema]);

  return null;
}
