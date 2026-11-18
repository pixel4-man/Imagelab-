import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Crosshair,
  ExternalLink,
  Layers,
  MousePointerClick,
  RefreshCw,
  X,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import {
  SelectedPlacementTarget,
  usePlacementSelector,
} from '../context/PlacementSelectorContext';
import {
  AD_TYPES,
  AdInsertPosition,
  AdStatus,
  AdType,
  DIMENSION_PRESETS,
  VisualPlacementRecord,
  formatReadableError,
  getAdTypeLabel,
  normalizePageRoute,
  normalizeSlotIdentifier,
} from '../types/ads';
import { createVisualPlacement } from '../lib/adsPersistence';
import { notifyActiveAdsUpdated } from './AdSlot';

interface BoxRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const ADMIN_OR_AUTH_PREFIXES = ['/admin', '/super-admin', '/login', '/signup'];

const QUICK_ROUTES = [
  { to: '/', label: 'Homepage' },
  { to: '/explore', label: 'Explore Prompts' },
  { to: '/trending', label: 'Trending' },
  { to: '/prompt/travertine-solstice-atrium', label: 'Prompt Details' },
  { to: '/saved', label: 'Saved' },
  { to: '/about', label: 'About' },
  { to: '/contact', label: 'Contact' },
];

function isPublicSelectableRoute(pathname: string): boolean {
  const norm = normalizePageRoute(pathname);
  return !ADMIN_OR_AUTH_PREFIXES.some(
    (prefix) => norm === prefix || norm.startsWith(`${prefix}/`)
  );
}

function buildCssSelector(el: HTMLElement): string {
  const explicitSlot = el.getAttribute('data-ad-slot');
  if (explicitSlot) {
    return `[data-ad-slot="${explicitSlot}"]`;
  }
  if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) {
    return `#${el.id}`;
  }

  const parts: string[] = [];
  let cur: HTMLElement | null = el;
  while (cur && cur.tagName.toLowerCase() !== 'body' && parts.length < 6) {
    const tag = cur.tagName.toLowerCase();
    const slot = cur.getAttribute('data-ad-slot');
    if (slot) {
      parts.unshift(`[data-ad-slot="${slot}"]`);
      break;
    }
    if (cur.id && /^[a-zA-Z][\w-]*$/.test(cur.id)) {
      parts.unshift(`#${cur.id}`);
      break;
    }
    const parent: HTMLElement | null = cur.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const sameTagSiblings = Array.from(parent.children).filter(
      (child) => child.tagName === cur!.tagName
    );
    const index = sameTagSiblings.indexOf(cur) + 1;
    parts.unshift(sameTagSiblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
    cur = parent;
  }
  return parts.join(' > ') || el.tagName.toLowerCase();
}

function describeElement(el: HTMLElement): {
  label: string;
  slotId: string;
  elementInfo: string;
} {
  const explicitSlot = el.getAttribute('data-ad-slot');
  const explicitLabel = el.getAttribute('data-ad-label');
  const tag = el.tagName.toLowerCase();

  const heading = el.querySelector('h1, h2, h3');
  const headingSnippet = heading?.textContent?.trim().slice(0, 48);

  const label =
    explicitLabel ||
    (headingSnippet ? `${tag} — "${headingSnippet}"` : '') ||
    (el.getAttribute('aria-label') || '').trim().slice(0, 48) ||
    `${tag.toUpperCase()} Section`;

  const rawSlot =
    explicitSlot ||
    `${tag}_${(el.getAttribute('data-ad-label') || headingSnippet || 'zone').slice(0, 32)}_${Math.round(
      el.getBoundingClientRect().top + window.scrollY
    )}`;

  return {
    label,
    slotId: normalizeSlotIdentifier(rawSlot) || `slot_${Date.now()}`,
    elementInfo: `${label} (<${tag}>)`.slice(0, 180),
  };
}

function resolveEligibleElement(rawTarget: EventTarget | null): HTMLElement | null {
  if (!(rawTarget instanceof HTMLElement)) return null;
  if (
    rawTarget.closest('[data-ad-overlay="true"]') ||
    rawTarget.closest('[data-imagelab-ad-container]') ||
    rawTarget.closest('header') ||
    rawTarget.closest('nav') ||
    rawTarget.closest('[role="dialog"]') ||
    rawTarget.closest('button, input, select, textarea, label, [role="button"]')
  ) {
    return null;
  }

  // Prefer the closest explicit semantic ad anchor
  const explicitSlotEl = rawTarget.closest<HTMLElement>('[data-ad-slot]');
  if (explicitSlotEl) {
    return explicitSlotEl;
  }

  // Otherwise walk up to nearest meaningful structural container (never buttons, inputs, or nav controls)
  let cur: HTMLElement | null = rawTarget;
  while (cur && cur !== document.body) {
    const tag = cur.tagName.toLowerCase();
    if (['button', 'input', 'select', 'textarea', 'label', 'a'].includes(tag)) {
      cur = cur.parentElement;
      continue;
    }
    if (['section', 'article', 'footer', 'aside', 'main'].includes(tag)) {
      const rect = cur.getBoundingClientRect();
      if (rect.width >= 180 && rect.height >= 44) {
        return cur;
      }
    }
    cur = cur.parentElement;
  }
  return null;
}

function getBoxRect(el: HTMLElement | null): BoxRect | null {
  if (!el || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return {
    top: r.top,
    left: r.left,
    width: r.width,
    height: r.height,
  };
}

function buildRouteDisplayName(pathname: string): string {
  const norm = normalizePageRoute(pathname);
  if (norm === '/') return 'Homepage';
  if (norm === '/explore') return 'Explore';
  if (norm === '/trending') return 'Trending';
  if (norm === '/saved') return 'Saved Prompts';
  if (norm.startsWith('/prompt')) return 'Prompt Details';
  if (norm === '/about') return 'About';
  if (norm === '/contact') return 'Contact';
  return norm.replace(/^\//, '').slice(0, 32) || 'Page';
}

export function VisualPlacementOverlay() {
  const {
    isPrivilegedAdmin,
    selectionMode,
    selectedTarget,
    exitSelectionMode,
    setSelectedTarget,
    clearSelectedTarget,
  } = usePlacementSelector();
  const { getIdToken } = useAuth();
  const { showToast } = useApp();
  const location = useLocation();
  const navigate = useNavigate();

  const [hoveredElement, setHoveredElement] = useState<HTMLElement | null>(null);
  const [hoveredLabel, setHoveredLabel] = useState<string>('');
  const [hoveredRect, setHoveredRect] = useState<BoxRect | null>(null);
  const [selectedRect, setSelectedRect] = useState<BoxRect | null>(null);

  const [placementName, setPlacementName] = useState('');
  const [insertPosition, setInsertPosition] = useState<AdInsertPosition>('after');
  const [adType, setAdType] = useState<AdType>('responsive_banner');
  const [width, setWidth] = useState('auto');
  const [height, setHeight] = useState('auto');
  const [status, setStatus] = useState<AdStatus>('active');
  const [priority, setPriority] = useState(10);
  const [wildcardPromptRoute, setWildcardPromptRoute] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedPlacement, setSavedPlacement] = useState<VisualPlacementRecord | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const savingRef = useRef(false);
  const lastTapRef = useRef<{ el: HTMLElement; time: number; x: number; y: number } | null>(
    null
  );

  const isSelectablePage = isPublicSelectableRoute(location.pathname);

  // Reset hovered/selected UI when switching pages
  useEffect(() => {
    setHoveredElement(null);
    setHoveredLabel('');
    setHoveredRect(null);
    clearSelectedTarget();
    setSavedPlacement(null);
    setSaveError(null);
  }, [location.pathname, clearSelectedTarget]);

  // Keep selected and hovered highlight outlines locked during scroll or resize
  useEffect(() => {
    if (!selectionMode) return;
    let raf = 0;
    const syncRects = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setHoveredRect(getBoxRect(hoveredElement));
        setSelectedRect(getBoxRect(selectedTarget?.element || null));
      });
    };

    syncRects();
    window.addEventListener('scroll', syncRects, { passive: true, capture: true });
    window.addEventListener('resize', syncRects, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', syncRects, { capture: true });
      window.removeEventListener('resize', syncRects);
    };
  }, [selectionMode, hoveredElement, selectedTarget]);

  const commitElementSelection = useCallback(
    (el: HTMLElement) => {
      const { label, slotId, elementInfo } = describeElement(el);
      const selector = buildCssSelector(el);
      const routeTitle = buildRouteDisplayName(location.pathname);
      const suggested = `${routeTitle} · ${label.replace(/\s*\(<[^>]+>\)$/, '')}`.slice(0, 110);

      const nextTarget: SelectedPlacementTarget = {
        pageRoute: normalizePageRoute(location.pathname),
        slotId,
        selector,
        elementInfo,
        suggestedName: suggested,
        position: 'after',
        element: el,
      };
      setSelectedTarget(nextTarget);
      setPlacementName(suggested);
      setInsertPosition('after');
      setAdType('responsive_banner');
      setWidth('auto');
      setHeight('auto');
      setStatus('active');
      setPriority(10);
      setWildcardPromptRoute(location.pathname.startsWith('/prompt/'));
      setSavedPlacement(null);
      setSaveError(null);
      setSelectedRect(getBoxRect(el));
    },
    [location.pathname, setSelectedTarget]
  );

  useEffect(() => {
    if (!selectionMode || !isSelectablePage) return;

    const onMouseMove = (e: MouseEvent) => {
      const eligible = resolveEligibleElement(e.target);
      if (eligible !== hoveredElement) {
        setHoveredElement(eligible);
        if (eligible) {
          setHoveredLabel(describeElement(eligible).label);
          setHoveredRect(getBoxRect(eligible));
        } else {
          setHoveredLabel('');
          setHoveredRect(null);
        }
      }
    };

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Allow clicking floating overlay bar or header navigation links
      if (target.closest('[data-ad-overlay="true"]') || target.closest('header') || target.closest('nav')) {
        return;
      }
      // Block unintended link/card navigation inside selection canvas
      if (target.closest('main') || target.closest('footer')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const onDblClick = (e: MouseEvent) => {
      const eligible = resolveEligibleElement(e.target);
      if (!eligible) return;
      e.preventDefault();
      e.stopPropagation();
      commitElementSelection(eligible);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-ad-overlay="true"]') || target.closest('header') || target.closest('nav')) {
        return;
      }
      const eligible = resolveEligibleElement(target);
      if (!eligible) return;

      const now = Date.now();
      const prev = lastTapRef.current;
      const isSecondTapOnSame =
        prev &&
        now - prev.time < 480 &&
        (prev.el === eligible ||
          (Math.abs(prev.x - e.clientX) < 40 && Math.abs(prev.y - e.clientY) < 40));

      if (isSecondTapOnSame) {
        lastTapRef.current = null;
        e.preventDefault();
        e.stopPropagation();
        commitElementSelection(eligible);
      } else {
        lastTapRef.current = {
          el: eligible,
          time: now,
          x: e.clientX,
          y: e.clientY,
        };
        setHoveredElement(eligible);
        setHoveredLabel(describeElement(eligible).label);
        setHoveredRect(getBoxRect(eligible));
      }
    };

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('dblclick', onDblClick, true);
    document.addEventListener('pointerup', onPointerUp, true);

    return () => {
      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('dblclick', onDblClick, true);
      document.removeEventListener('pointerup', onPointerUp, true);
    };
  }, [selectionMode, isSelectablePage, hoveredElement, commitElementSelection]);

  if (!selectionMode || !isPrivilegedAdmin) {
    return null;
  }

  const effectivePageRoute =
    selectedTarget && selectedTarget.pageRoute.startsWith('/prompt/') && wildcardPromptRoute
      ? '/prompt/*'
      : selectedTarget?.pageRoute || normalizePageRoute(location.pathname);

  const handleConfirmPlacement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTarget || savingRef.current) return;
    savingRef.current = true;
    setSaveError(null);
    setSaving(true);
    try {
      const created = await createVisualPlacement(
        {
          name: placementName.trim(),
          pageRoute: effectivePageRoute,
          slotId: selectedTarget.slotId,
          selector: selectedTarget.selector,
          elementInfo: selectedTarget.elementInfo,
          position: insertPosition,
          width: width.trim() || 'auto',
          height: height.trim() || 'auto',
          adType,
          status,
          priority,
        },
        getIdToken
      );

      setSavedPlacement(created);
      notifyActiveAdsUpdated();
      showToast(`Placement "${created.name}" saved`, 'teal');
    } catch (err) {
      setSaveError(formatReadableError(err, 'Could not save visual placement.'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const selectedDimensionPresetKey =
    DIMENSION_PRESETS.find((p) => p.width === width && p.height === height)?.key || 'custom';

  return (
    <>
      {/* Soft Hover / First-Tap Highlight Box (Teal) */}
      {isSelectablePage && hoveredRect && (!selectedTarget || hoveredElement !== selectedTarget.element) && (
        <div
          aria-hidden="true"
          className="fixed pointer-events-none z-[70] rounded-2xl border-2 border-dashed border-[#2A9D8F] bg-[#2A9D8F]/8 transition-all duration-75"
          style={{
            top: hoveredRect.top,
            left: hoveredRect.left,
            width: hoveredRect.width,
            height: hoveredRect.height,
          }}
        >
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-br-xl rounded-tl-xl bg-[#2A9D8F] text-white text-[11px] font-semibold shadow-sm max-w-[90vw] truncate">
            <MousePointerClick className="w-3 h-3 shrink-0" />
            <span className="truncate">{hoveredLabel} · Double tap to select</span>
          </span>
        </div>
      )}

      {/* Selected Element Highlight Box (Terracotta) */}
      {isSelectablePage && selectedTarget && selectedRect && (
        <div
          aria-hidden="true"
          className="fixed pointer-events-none z-[72] rounded-2xl border-[3px] border-[#E76F51] bg-[#E76F51]/10 shadow-[0_0_0_4px_rgba(231,111,81,0.2)] transition-all duration-100"
          style={{
            top: selectedRect.top,
            left: selectedRect.left,
            width: selectedRect.width,
            height: selectedRect.height,
          }}
        >
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-br-xl rounded-tl-xl bg-[#E76F51] text-white text-[11px] font-bold shadow">
            <Crosshair className="w-3 h-3" />
            <span>Selected ({insertPosition.toUpperCase()})</span>
          </span>
        </div>
      )}

      {/* Top Floating Selection Mode Toolbar */}
      <div
        data-ad-overlay="true"
        className="fixed top-2 left-1/2 -translate-x-1/2 z-[80] w-[calc(100%-1rem)] max-w-5xl rounded-2xl bg-[#264653]/96 backdrop-blur-md text-[#FAF7F2] border border-[#FAF7F2]/15 shadow-2xl px-3.5 py-2.5 space-y-2"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full bg-[#E76F51] animate-pulse shrink-0" />
            <p className="text-xs sm:text-sm font-bold tracking-tight truncate">
              PLACEMENT SELECTION MODE — Double tap any area to select it.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                exitSelectionMode();
                navigate('/admin/ads');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] text-white text-xs font-semibold transition-colors min-h-[34px]"
            >
              <span>Ads Manager</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={exitSelectionMode}
              aria-label="Exit placement selection mode"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#FAF7F2]/12 hover:bg-[#FAF7F2]/22 text-[#FAF7F2] text-xs font-semibold transition-colors min-h-[34px]"
            >
              <X className="w-3.5 h-3.5" />
              <span>Exit</span>
            </button>
          </div>
        </div>

        {/* Page Navigation Strip inside Selection Mode */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1 border-t border-[#FAF7F2]/12">
          <span className="text-[11px] font-mono text-[#F4EDE4]/60 shrink-0 mr-1">
            Pages:
          </span>
          {QUICK_ROUTES.map((r) => {
            const active = normalizePageRoute(location.pathname) === r.to;
            return (
              <button
                key={r.to}
                type="button"
                onClick={() => navigate(r.to)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  active
                    ? 'bg-[#2A9D8F] text-white'
                    : 'bg-[#FAF7F2]/10 text-[#F4EDE4]/85 hover:bg-[#FAF7F2]/20'
                }`}
              >
                {r.label}
              </button>
            );
          })}
          {!isSelectablePage && (
            <span className="text-[11px] text-[#E76F51] font-medium ml-auto shrink-0">
              Navigate to a public page above to select a placement
            </span>
          )}
        </div>
      </div>

      {/* Bottom-Right / Centered Confirmation Panel */}
      {selectedTarget && (
        <div
          data-ad-overlay="true"
          role="dialog"
          aria-modal="false"
          aria-label="Confirm Selected Ad Placement"
          className="fixed bottom-4 right-4 left-4 sm:left-auto z-[85] sm:w-[440px] max-h-[82vh] overflow-y-auto rounded-3xl bg-[#FAF7F2] border-2 border-[#E76F51] shadow-2xl p-5 sm:p-6 space-y-4"
        >
          {savedPlacement ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-[#2A9D8F]/14 text-[#2A9D8F] flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[#2A9D8F]">
                      Placement Saved
                    </p>
                    <h3 className="text-base font-bold text-[#264653]">
                      {savedPlacement.name}
                    </h3>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={clearSelectedTarget}
                  aria-label="Close panel"
                  className="p-1.5 rounded-lg text-[#264653]/60 hover:bg-[#F4EDE4]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="rounded-xl bg-[#F4EDE4]/80 border border-[#264653]/12 p-3 text-xs space-y-1">
                <p>
                  <strong>Page:</strong>{' '}
                  <span className="font-mono">{savedPlacement.pageRoute}</span>
                </p>
                <p>
                  <strong>Position:</strong> {savedPlacement.position.toUpperCase()} target area ·{' '}
                  <strong>Status:</strong>{' '}
                  {savedPlacement.status === 'active' ? 'Enabled' : 'Disabled'}
                </p>
                <p>
                  <strong>Format:</strong> {getAdTypeLabel(savedPlacement.adType)} ·{' '}
                  <strong>Size:</strong>{' '}
                  <span className="font-mono">
                    {savedPlacement.width} × {savedPlacement.height}
                  </span>
                </p>
                <p className="truncate">
                  <strong>Element:</strong> {savedPlacement.elementInfo}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    const id = savedPlacement.id;
                    exitSelectionMode();
                    navigate(`/admin/ads?placementId=${encodeURIComponent(id)}`);
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] text-white text-xs font-semibold min-h-[42px]"
                >
                  <span>Create Ad Here</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearSelectedTarget();
                    setSavedPlacement(null);
                  }}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#264653] hover:bg-[#355C6B] text-white text-xs font-semibold min-h-[42px]"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Select Another Area</span>
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleConfirmPlacement} className="space-y-3.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[#E76F51]">
                    Placement Confirmation
                  </p>
                  <h3 className="text-base font-bold text-[#264653]">
                    Configure Visual Ad Slot
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={clearSelectedTarget}
                  aria-label="Cancel selection"
                  className="p-1.5 rounded-lg text-[#264653]/60 hover:bg-[#F4EDE4]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="rounded-xl bg-[#F4EDE4]/75 border border-[#264653]/12 p-3 text-xs space-y-1 text-[#264653]/85">
                <p>
                  <strong>Page:</strong>{' '}
                  <span className="font-mono text-[#264653]">{effectivePageRoute}</span>
                </p>
                <p className="truncate">
                  <strong>Selected Area:</strong> {selectedTarget.elementInfo}
                </p>
              </div>

              {selectedTarget.pageRoute.startsWith('/prompt/') && (
                <label className="flex items-center gap-2 text-xs text-[#264653] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={wildcardPromptRoute}
                    onChange={(e) => setWildcardPromptRoute(e.target.checked)}
                    className="rounded border-[#264653]/30 text-[#2A9D8F] focus:ring-[#2A9D8F]"
                  />
                  <span>Apply across all Prompt Detail pages (/prompt/*)</span>
                </label>
              )}

              <div>
                <label className="block text-xs font-bold text-[#264653] mb-1">
                  Placement Name *
                </label>
                <input
                  type="text"
                  required
                  value={placementName}
                  onChange={(e) => setPlacementName(e.target.value)}
                  placeholder="e.g., Homepage Below Hero"
                  className="w-full h-10 px-3 rounded-xl bg-white border border-[#264653]/18 text-sm text-[#264653] focus:outline-none focus:border-[#2A9D8F]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#264653] mb-1">
                  Insertion Position Relative to Selected Element
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { value: 'before', label: 'Before Area' },
                      { value: 'after', label: 'After Area' },
                      { value: 'inside', label: 'Inside Area' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setInsertPosition(opt.value)}
                      className={`py-2 px-2 rounded-xl text-xs font-semibold border transition-colors ${
                        insertPosition === opt.value
                          ? 'bg-[#264653] text-white border-[#264653]'
                          : 'bg-[#F4EDE4]/70 text-[#264653] border-[#264653]/15 hover:border-[#2A9D8F]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-bold text-[#264653] mb-1">
                    Ad Type
                  </label>
                  <select
                    value={adType}
                    onChange={(e) => setAdType(e.target.value as AdType)}
                    className="w-full h-9 px-2.5 rounded-xl bg-white border border-[#264653]/18 text-xs font-semibold text-[#264653] focus:outline-none focus:border-[#2A9D8F]"
                  >
                    {AD_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#264653] mb-1">
                    Dimension Preset
                  </label>
                  <select
                    value={selectedDimensionPresetKey}
                    onChange={(e) => {
                      const preset = DIMENSION_PRESETS.find((p) => p.key === e.target.value);
                      if (preset) {
                        setWidth(preset.width);
                        setHeight(preset.height);
                      }
                    }}
                    className="w-full h-9 px-2.5 rounded-xl bg-white border border-[#264653]/18 text-xs font-semibold text-[#264653] focus:outline-none focus:border-[#2A9D8F]"
                  >
                    {DIMENSION_PRESETS.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                    <option value="custom">Custom Dimensions</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-[#264653] mb-1">
                    Width
                  </label>
                  <input
                    type="text"
                    value={width}
                    onChange={(e) => setWidth(e.target.value)}
                    placeholder="auto"
                    className="w-full h-9 px-2.5 rounded-xl bg-white border border-[#264653]/18 font-mono text-xs text-[#264653] focus:outline-none focus:border-[#2A9D8F]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-[#264653] mb-1">
                    Height
                  </label>
                  <input
                    type="text"
                    value={height}
                    onChange={(e) => setHeight(e.target.value)}
                    placeholder="auto"
                    className="w-full h-9 px-2.5 rounded-xl bg-white border border-[#264653]/18 font-mono text-xs text-[#264653] focus:outline-none focus:border-[#2A9D8F]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-[#264653] mb-1">
                    Status
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as AdStatus)}
                    className="w-full h-9 px-2 rounded-xl bg-white border border-[#264653]/18 text-xs font-semibold text-[#264653] focus:outline-none focus:border-[#2A9D8F]"
                  >
                    <option value="active">Enabled</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-[#264653] mb-1">
                    Priority
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={priority}
                    onChange={(e) =>
                      setPriority(Math.max(1, Math.min(999, Number(e.target.value) || 10)))
                    }
                    className="w-full h-9 px-2.5 rounded-xl bg-white border border-[#264653]/18 font-mono text-xs text-[#264653] focus:outline-none focus:border-[#2A9D8F]"
                  />
                </div>
              </div>

              {/* Visual Placeholder Preview */}
              <div className="rounded-xl border border-dashed border-[#2A9D8F]/60 bg-[#2A9D8F]/8 p-3 flex items-center justify-between gap-2 text-xs text-[#264653]">
                <div className="flex items-center gap-2 min-w-0">
                  <Layers className="w-4 h-4 text-[#2A9D8F] shrink-0" />
                  <span className="font-medium truncate">
                    {getAdTypeLabel(adType)} ({insertPosition} · {effectivePageRoute})
                  </span>
                </div>
                <span className="font-mono text-[10px] text-[#264653]/75 shrink-0">
                  {width || 'auto'} × {height || 'auto'}
                </span>
              </div>

              {saveError && (
                <div
                  role="alert"
                  className="rounded-xl bg-[#E76F51]/12 border border-[#E76F51]/40 px-3 py-2 text-xs font-medium text-[#9A3412]"
                >
                  {saveError}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#264653]/10">
                <button
                  type="button"
                  onClick={clearSelectedTarget}
                  className="px-3.5 py-2 rounded-xl bg-[#F4EDE4] hover:bg-[#E8DEC8] text-[#264653] text-xs font-semibold min-h-[40px]"
                >
                  Select Another Area
                </button>

                <button
                  type="submit"
                  disabled={saving || placementName.trim().length < 2}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] disabled:opacity-60 text-white text-xs font-semibold min-h-[40px]"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{saving ? 'Saving...' : 'Confirm Placement'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </>
  );
}
