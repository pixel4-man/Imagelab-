import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

export const DEFAULT_PRODUCTION_ORIGIN = 'https://imagelab.imagemart.workers.dev';

export const PUBLIC_STATIC_ROUTES = [
  { path: '/', changefreq: 'daily', priority: '1.0' },
  { path: '/explore', changefreq: 'daily', priority: '0.9' },
  { path: '/trending', changefreq: 'daily', priority: '0.9' },
  { path: '/about', changefreq: 'monthly', priority: '0.6' },
  { path: '/contact', changefreq: 'monthly', priority: '0.5' },
  { path: '/privacy', changefreq: 'yearly', priority: '0.3' },
  { path: '/terms', changefreq: 'yearly', priority: '0.3' },
];

export const DISALLOWED_ROBOTS_PATHS = [
  '/admin',
  '/admin/*',
  '/super-admin',
  '/dashboard',
  '/profile',
  '/saved',
  '/publish',
  '/login',
  '/signup',
];

export function resolveSiteOrigin(rawOverride) {
  const candidates = [
    rawOverride,
    process.env.PUBLIC_SITE_URL,
    process.env.VITE_SITE_URL,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim().replace(/\/+$/, '');
    if (
      !trimmed ||
      trimmed === 'MY_APP_URL' ||
      !/^https?:\/\/[a-zA-Z0-9.-]+(:\d+)?$/i.test(trimmed)
    ) {
      continue;
    }
    return trimmed;
  }
  return DEFAULT_PRODUCTION_ORIGIN;
}

export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function normalizeDateString(val) {
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val.trim())) {
    return val.trim().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

export function readFallbackSeededPrompts(rootDir = ROOT_DIR) {
  const seedFile = path.join(rootDir, 'src', 'server', 'seededPromptsData.ts');
  if (!fs.existsSync(seedFile)) return [];
  const source = fs.readFileSync(seedFile, 'utf-8');
  const entries = [];
  const blockRegex =
    /id:\s*'([a-zA-Z0-9_-]{1,128})'[\s\S]*?createdAt:\s*'(\d{4}-\d{2}-\d{2})'/g;
  let match;
  while ((match = blockRegex.exec(source)) !== null) {
    entries.push({
      id: match[1],
      lastmod: match[2],
    });
  }
  return entries;
}

export async function fetchApprovedPromptEntries(rootDir = ROOT_DIR) {
  const configPath = path.join(rootDir, 'firebase-applet-config.json');
  if (!fs.existsSync(configPath)) {
    return { entries: readFallbackSeededPrompts(rootDir), source: 'fallback' };
  }

  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return { entries: readFallbackSeededPrompts(rootDir), source: 'fallback' };
  }

  const projectId = typeof cfg.projectId === 'string' ? cfg.projectId.trim() : '';
  const databaseId =
    typeof cfg.firestoreDatabaseId === 'string' && cfg.firestoreDatabaseId.trim()
      ? cfg.firestoreDatabaseId.trim()
      : '(default)';

  if (!projectId) {
    return { entries: readFallbackSeededPrompts(rootDir), source: 'fallback' };
  }

  const queryUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/${encodeURIComponent(databaseId)}/documents:runQuery`;

  try {
    // Public read-only query of approved prompt IDs & timestamps (never reads promptText/promptSecrets/PII)
    const response = await fetch(queryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(6000),
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'prompts' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'status' },
              op: 'EQUAL',
              value: { stringValue: 'approved' },
            },
          },
          select: {
            fields: [
              { fieldPath: 'updatedAt' },
              { fieldPath: 'createdAt' },
              { fieldPath: 'status' },
            ],
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Firestore runQuery returned HTTP ${response.status}`);
    }

    const rows = await response.json();
    if (!Array.isArray(rows)) {
      throw new Error('Unexpected Firestore runQuery payload');
    }

    const byId = new Map();
    for (const row of rows) {
      const doc = row?.document;
      if (!doc || typeof doc.name !== 'string') continue;
      const status = doc.fields?.status?.stringValue;
      if (status !== 'approved') continue;
      const id = doc.name.split('/').pop() || '';
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) continue;
      const rawUpdated =
        doc.fields?.updatedAt?.timestampValue ||
        doc.fields?.updatedAt?.stringValue ||
        doc.fields?.createdAt?.timestampValue ||
        doc.fields?.createdAt?.stringValue ||
        doc.updateTime;
      byId.set(id, {
        id,
        lastmod: normalizeDateString(rawUpdated),
      });
    }

    const entries = Array.from(byId.values()).sort((a, b) => {
      const dateCmp = b.lastmod.localeCompare(a.lastmod);
      return dateCmp !== 0 ? dateCmp : a.id.localeCompare(b.id);
    });

    // If a brand-new database has 0 docs yet, fall back cleanly to seeded showcase metadata
    if (entries.length === 0) {
      return { entries: readFallbackSeededPrompts(rootDir), source: 'fallback-empty' };
    }

    return { entries, source: 'firestore' };
  } catch {
    return { entries: readFallbackSeededPrompts(rootDir), source: 'fallback' };
  }
}

export function buildSitemapXml(origin, promptEntries) {
  const cleanOrigin = origin.replace(/\/+$/, '');
  const seen = new Set();
  const urlBlocks = [];

  for (const route of PUBLIC_STATIC_ROUTES) {
    const loc = `${cleanOrigin}${route.path}`;
    if (seen.has(loc)) continue;
    seen.add(loc);
    urlBlocks.push(
      [
        '  <url>',
        `    <loc>${escapeXml(loc)}</loc>`,
        `    <changefreq>${route.changefreq}</changefreq>`,
        `    <priority>${route.priority}</priority>`,
        '  </url>',
      ].join('\n')
    );
  }

  for (const entry of promptEntries) {
    if (!entry || !/^[a-zA-Z0-9_-]{1,128}$/.test(entry.id)) continue;
    const loc = `${cleanOrigin}/prompt/${encodeURIComponent(entry.id)}`;
    if (seen.has(loc)) continue;
    seen.add(loc);
    const lastmod = normalizeDateString(entry.lastmod);
    urlBlocks.push(
      [
        '  <url>',
        `    <loc>${escapeXml(loc)}</loc>`,
        `    <lastmod>${escapeXml(lastmod)}</lastmod>`,
        '    <changefreq>weekly</changefreq>',
        '    <priority>0.8</priority>',
        '  </url>',
      ].join('\n')
    );
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urlBlocks,
    '</urlset>',
    '',
  ].join('\n');
}

export function buildRobotsTxt(origin) {
  const cleanOrigin = origin.replace(/\/+$/, '');
  return [
    'User-agent: *',
    'Allow: /',
    ...DISALLOWED_ROBOTS_PATHS.map((p) => `Disallow: ${p}`),
    '',
    `Sitemap: ${cleanOrigin}/sitemap.xml`,
    '',
  ].join('\n');
}

export async function generateSeoFiles(options = {}) {
  const rootDir = options.rootDir || ROOT_DIR;
  const publicDir = path.join(rootDir, 'public');
  const origin = resolveSiteOrigin(options.origin);
  const { entries, source } = await fetchApprovedPromptEntries(rootDir);

  fs.mkdirSync(publicDir, { recursive: true });

  const sitemapXml = buildSitemapXml(origin, entries);
  const robotsTxt = buildRobotsTxt(origin);

  const sitemapPath = path.join(publicDir, 'sitemap.xml');
  const robotsPath = path.join(publicDir, 'robots.txt');

  fs.writeFileSync(sitemapPath, sitemapXml, 'utf-8');
  fs.writeFileSync(robotsPath, robotsTxt, 'utf-8');

  return {
    origin,
    source,
    promptCount: entries.length,
    totalUrls: PUBLIC_STATIC_ROUTES.length + entries.length,
    sitemapPath,
    robotsPath,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename)
) {
  generateSeoFiles()
    .then((result) => {
      console.log(
        `[seo] Generated public/sitemap.xml (${result.totalUrls} URLs, ${result.promptCount} prompts via ${result.source}) and public/robots.txt for ${result.origin}`
      );
    })
    .catch((err) => {
      console.error('[seo] Failed to generate SEO files:', err);
      process.exitCode = 1;
    });
}
