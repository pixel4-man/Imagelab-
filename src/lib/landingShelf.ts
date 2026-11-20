import type { PromptItem, TrendingTab } from '../types/prompt';

export type ShelfCategoryId =
  | 'all'
  | 'today'
  | 'liked'
  | 'copied'
  | 'recent'
  | 'community';

export interface ShelfCategoryTab {
  id: ShelfCategoryId;
  label: string;
  accentColor: string;
  items: PromptItem[];
}

export interface ShelfTransformOptions {
  cardWidth: number;
  viewportWidth: number;
  prefersReducedMotion?: boolean;
  tiltX?: number;
  tiltY?: number;
}

export interface ShelfCardTransform {
  visible: boolean;
  isActive: boolean;
  translateX: number;
  translateZ: number;
  rotateY: number;
  rotateX: number;
  scale: number;
  opacity: number;
  zIndex: number;
}

const COLLECTION_LABELS: Record<TrendingTab, string> = {
  today: 'Trending Today',
  week: 'Weekly Selection',
  copied: 'Most Studied',
  liked: 'Community Favorite',
  recent: 'Recent Archive',
};

export function deriveShelfCategories(prompts: PromptItem[]): ShelfCategoryTab[] {
  if (!Array.isArray(prompts) || prompts.length === 0) {
    return [];
  }

  const candidates: Array<{
    id: ShelfCategoryId;
    label: string;
    accentColor: string;
    matcher: (p: PromptItem) => boolean;
  }> = [
    {
      id: 'all',
      label: 'All Works',
      accentColor: '#E76F51',
      matcher: () => true,
    },
    {
      id: 'today',
      label: 'Trending Today',
      accentColor: '#2A9D8F',
      matcher: (p) =>
        Array.isArray(p.trendingCollections) &&
        p.trendingCollections.includes('today'),
    },
    {
      id: 'liked',
      label: 'Most Liked',
      accentColor: '#264653',
      matcher: (p) =>
        Array.isArray(p.trendingCollections) &&
        p.trendingCollections.includes('liked'),
    },
    {
      id: 'copied',
      label: 'Most Copied',
      accentColor: '#E76F51',
      matcher: (p) =>
        Array.isArray(p.trendingCollections) &&
        p.trendingCollections.includes('copied'),
    },
    {
      id: 'recent',
      label: 'Recent Archive',
      accentColor: '#2A9D8F',
      matcher: (p) =>
        Array.isArray(p.trendingCollections) &&
        p.trendingCollections.includes('recent'),
    },
    {
      id: 'community',
      label: 'Community',
      accentColor: '#264653',
      matcher: (p) => p.authorType === 'contributor',
    },
  ];

  const tabs: ShelfCategoryTab[] = [];
  for (const candidate of candidates) {
    const matched = prompts.filter(candidate.matcher);
    if (matched.length > 0) {
      tabs.push({
        id: candidate.id,
        label: candidate.label,
        accentColor: candidate.accentColor,
        items: matched,
      });
    }
  }

  return tabs;
}

export function stepShelfIndex(
  currentIndex: number,
  delta: number,
  total: number
): number {
  if (total <= 0) return 0;
  const next = (currentIndex + delta) % total;
  return next < 0 ? next + total : next;
}

export function computeShelfOffset(
  index: number,
  activeIndex: number,
  total: number
): number {
  if (total <= 1) return 0;
  let offset = index - activeIndex;
  // Use continuous circular shortest-path offset when enough artworks surround the focal card
  if (total >= 5) {
    const half = total / 2;
    if (offset > half) offset -= total;
    if (offset < -half) offset += total;
  }
  return offset;
}

export function computeShelfCardTransform(
  offset: number,
  options: ShelfTransformOptions
): ShelfCardTransform {
  const {
    cardWidth,
    viewportWidth,
    prefersReducedMotion = false,
    tiltX = 0,
    tiltY = 0,
  } = options;

  const absOffset = Math.abs(offset);
  const maxVisibleSide = viewportWidth < 640 ? 1 : viewportWidth < 1024 ? 2 : 3;

  if (absOffset > maxVisibleSide) {
    const dir = offset >= 0 ? 1 : -1;
    return {
      visible: false,
      isActive: false,
      translateX: dir * (cardWidth * (maxVisibleSide + 0.9)),
      translateZ: -200,
      rotateY: dir * -36,
      rotateX: 0,
      scale: 0.68,
      opacity: 0,
      zIndex: 1,
    };
  }

  if (offset === 0) {
    return {
      visible: true,
      isActive: true,
      translateX: 0,
      translateZ: prefersReducedMotion ? 16 : viewportWidth < 640 ? 44 : 112,
      rotateY: prefersReducedMotion ? 0 : tiltY,
      rotateX: prefersReducedMotion ? 0 : tiltX,
      scale: 1,
      opacity: 1,
      zIndex: 30,
    };
  }

  const sign = offset > 0 ? 1 : -1;
  const isCompact = viewportWidth < 640;
  const isTablet = viewportWidth >= 640 && viewportWidth < 1024;

  // Tight physical spacing calibrated for 360px–1440px without crowding center card
  const firstGap = isCompact
    ? cardWidth * 0.72
    : isTablet
      ? cardWidth * 0.88
      : cardWidth * 0.96;
  const stepGap = isCompact
    ? cardWidth * 0.56
    : isTablet
      ? cardWidth * 0.68
      : cardWidth * 0.74;

  const translateX = sign * (firstGap + (absOffset - 1) * stepGap);
  const translateZ = prefersReducedMotion
    ? -absOffset * 18
    : -(36 + absOffset * (isCompact ? 34 : 46));
  const rotateY = prefersReducedMotion
    ? 0
    : sign * -(isCompact ? 20 : Math.min(36, 22 + (absOffset - 1) * 7));
  const scale = Math.max(0.7, 1 - absOffset * (isCompact ? 0.14 : 0.1));
  const opacity = Math.max(0.32, 1 - absOffset * 0.22);

  return {
    visible: true,
    isActive: false,
    translateX,
    translateZ,
    rotateY,
    rotateX: 0,
    scale,
    opacity,
    zIndex: 25 - Math.round(absOffset * 5),
  };
}

export function resolveSwipeStep(deltaX: number, thresholdPx = 40): number {
  if (deltaX <= -thresholdPx) return 1;
  if (deltaX >= thresholdPx) return -1;
  return 0;
}

export function getPreloadIndices(activeIndex: number, total: number): number[] {
  if (total <= 0) return [];
  const indices = [
    stepShelfIndex(activeIndex, -1, total),
    stepShelfIndex(activeIndex, 0, total),
    stepShelfIndex(activeIndex, 1, total),
  ];
  return Array.from(new Set(indices));
}

export function getPrimaryCollectionLabel(prompt: PromptItem): string {
  if (Array.isArray(prompt.trendingCollections) && prompt.trendingCollections.length > 0) {
    const first = prompt.trendingCollections[0];
    if (first && COLLECTION_LABELS[first]) {
      return COLLECTION_LABELS[first];
    }
  }
  return prompt.authorType === 'contributor' ? 'Community Creation' : 'Official Archive';
}

export function formatPublicEditorialSubtitle(prompt: PromptItem): string {
  const collection = getPrimaryCollectionLabel(prompt);
  const authorKind =
    prompt.authorType === 'contributor' ? 'Community Studio' : 'Curated Archive';
  return `${collection} · ${authorKind} — Open artwork to inspect visual details and access the full prompt.`;
}
