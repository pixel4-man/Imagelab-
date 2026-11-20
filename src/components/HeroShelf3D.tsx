import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, ArrowUpRight, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { SafeImage } from './SafeImage';
import { useApp } from '../context/AppContext';
import {
  computeShelfCardTransform,
  computeShelfOffset,
  deriveShelfCategories,
  formatPublicEditorialSubtitle,
  getPreloadIndices,
  getPrimaryCollectionLabel,
  resolveSwipeStep,
  ShelfCategoryId,
  stepShelfIndex,
} from '../lib/landingShelf';
import { PromptItem } from '../types/prompt';

interface ExpandingSheetState {
  prompt: PromptItem;
  rect: { top: number; left: number; width: number; height: number };
}

export function HeroShelf3D() {
  const { prompts, getCreator } = useApp();
  const navigate = useNavigate();

  const categories = useMemo(() => deriveShelfCategories(prompts), [prompts]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<ShelfCategoryId>('all');
  const [activeIndex, setActiveIndex] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1280
  );
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [expandingSheet, setExpandingSheet] = useState<ExpandingSheetState | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const activeCardRef = useRef<HTMLDivElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const tabButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const captionTitleMaskRef = useRef<HTMLDivElement>(null);
  const captionMetaMaskRef = useRef<HTMLDivElement>(null);
  const portalSheetRef = useRef<HTMLDivElement>(null);

  const [tabIndicator, setTabIndicator] = useState({ left: 0, width: 0, ready: false });

  // Unified pointer tilt animation state
  const targetTiltRef = useRef({ x: 0, y: 0 });
  const currentTiltRef = useRef({ x: 0, y: 0 });
  const tiltRafRef = useRef<number | null>(null);

  // Drag / swipe & wheel state
  const pointerDragRef = useRef<{
    active: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    hasMoved: boolean;
  }>({ active: false, pointerId: -1, startX: 0, startY: 0, hasMoved: false });
  const lastWheelNavRef = useRef(0);
  const preloadedUrlsRef = useRef<Set<string>>(new Set());
  const navTimerRef = useRef<number | null>(null);

  // Sync active category cleanly if prompts dynamically update
  const activeCategory = useMemo(() => {
    if (categories.length === 0) return null;
    return categories.find((cat) => cat.id === selectedCategoryId) || categories[0];
  }, [categories, selectedCategoryId]);

  const shelfItems = activeCategory?.items || [];
  const safeActiveIndex =
    shelfItems.length > 0 ? Math.min(activeIndex, shelfItems.length - 1) : 0;
  const activePrompt = shelfItems[safeActiveIndex] || null;
  const activeCreator = activePrompt ? getCreator(activePrompt.creatorUsername) : null;

  // Viewport + reduced-motion listeners
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => setViewportWidth(window.innerWidth);
    const motionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotion = () => setPrefersReducedMotion(motionMq.matches);

    syncMotion();
    window.addEventListener('resize', handleResize);
    motionMq.addEventListener?.('change', syncMotion);

    return () => {
      window.removeEventListener('resize', handleResize);
      motionMq.removeEventListener?.('change', syncMotion);
    };
  }, []);

  // Sliding colored indicator under active category tab
  const updateTabIndicator = useCallback(() => {
    if (!activeCategory || !tabListRef.current) return;
    const btn = tabButtonRefs.current[activeCategory.id];
    if (!btn) return;
    setTabIndicator({
      left: btn.offsetLeft,
      width: btn.offsetWidth,
      ready: true,
    });
  }, [activeCategory]);

  useEffect(() => {
    updateTabIndicator();
    if (typeof ResizeObserver === 'undefined' || !tabListRef.current) return;
    const ro = new ResizeObserver(updateTabIndicator);
    ro.observe(tabListRef.current);
    return () => ro.disconnect();
  }, [updateTabIndicator, viewportWidth]);

  // Preload active and neighboring images once each
  useEffect(() => {
    if (shelfItems.length === 0) return;
    const indices = getPreloadIndices(safeActiveIndex, shelfItems.length);
    for (const idx of indices) {
      const url = shelfItems[idx]?.imageUrl;
      if (url && !preloadedUrlsRef.current.has(url)) {
        preloadedUrlsRef.current.add(url);
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
      }
    }
  }, [shelfItems, safeActiveIndex]);

  // Masked vertical slide caption transition via Web Animations API
  useEffect(() => {
    if (!activePrompt || prefersReducedMotion) return;
    const animations: Animation[] = [];
    const animateMask = (el: HTMLDivElement | null, delayMs: number) => {
      if (!el || typeof el.animate !== 'function') return;
      const anim = el.animate(
        [
          {
            transform: 'translate3d(0, 22px, 0)',
            clipPath: 'inset(0 0 100% 0)',
          },
          {
            transform: 'translate3d(0, 0, 0)',
            clipPath: 'inset(0 0 0% 0)',
          },
        ],
        {
          duration: 420,
          delay: delayMs,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          fill: 'both',
        }
      );
      animations.push(anim);
    };

    animateMask(captionTitleMaskRef.current, 0);
    animateMask(captionMetaMaskRef.current, 55);

    return () => {
      animations.forEach((anim) => anim.cancel());
    };
  }, [activePrompt?.id, prefersReducedMotion]);

  // Unified rAF tilt smoothing for the focused artwork
  useEffect(() => {
    if (prefersReducedMotion || viewportWidth < 768) {
      setTilt({ x: 0, y: 0 });
      return;
    }

    let running = true;
    const tick = () => {
      if (!running) return;
      const dx = targetTiltRef.current.x - currentTiltRef.current.x;
      const dy = targetTiltRef.current.y - currentTiltRef.current.y;
      if (Math.abs(dx) > 0.015 || Math.abs(dy) > 0.015) {
        currentTiltRef.current.x += dx * 0.14;
        currentTiltRef.current.y += dy * 0.14;
        setTilt({
          x: Number(currentTiltRef.current.x.toFixed(3)),
          y: Number(currentTiltRef.current.y.toFixed(3)),
        });
      }
      tiltRafRef.current = window.requestAnimationFrame(tick);
    };

    tiltRafRef.current = window.requestAnimationFrame(tick);
    return () => {
      running = false;
      if (tiltRafRef.current !== null) {
        window.cancelAnimationFrame(tiltRafRef.current);
        tiltRafRef.current = null;
      }
    };
  }, [prefersReducedMotion, viewportWidth]);

  // Cleanup sheet transition timer on unmount
  useEffect(() => {
    return () => {
      if (navTimerRef.current !== null) {
        window.clearTimeout(navTimerRef.current);
      }
    };
  }, []);

  const stepBy = useCallback(
    (delta: number) => {
      if (shelfItems.length <= 1) return;
      targetTiltRef.current = { x: 0, y: 0 };
      setActiveIndex((prev) => stepShelfIndex(prev, delta, shelfItems.length));
    },
    [shelfItems.length]
  );

  const openPromptDetail = useCallback(
    (prompt: PromptItem) => {
      if (expandingSheet) return;
      const targetPath = `/prompt/${prompt.id}`;

      if (prefersReducedMotion || !activeCardRef.current) {
        navigate(targetPath);
        return;
      }

      const rect = activeCardRef.current.getBoundingClientRect();
      setExpandingSheet({
        prompt,
        rect: {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        },
      });
    },
    [expandingSheet, navigate, prefersReducedMotion]
  );

  // Physical-sheet portal reveal animation before navigating to /prompt/:id
  useEffect(() => {
    if (!expandingSheet || !portalSheetRef.current) return;
    const sheetEl = portalSheetRef.current;
    const { rect, prompt } = expandingSheet;

    const anim =
      typeof sheetEl.animate === 'function'
        ? sheetEl.animate(
            [
              {
                top: `${rect.top}px`,
                left: `${rect.left}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`,
                borderRadius: '18px',
                opacity: 1,
              },
              {
                top: '0px',
                left: '0px',
                width: '100vw',
                height: '100vh',
                borderRadius: '0px',
                opacity: 1,
              },
            ],
            {
              duration: 340,
              easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
              fill: 'forwards',
            }
          )
        : null;

    navTimerRef.current = window.setTimeout(() => {
      navigate(`/prompt/${prompt.id}`, { state: { fromShelf: true } });
    }, 280);

    return () => {
      anim?.cancel();
      if (navTimerRef.current !== null) {
        window.clearTimeout(navTimerRef.current);
        navTimerRef.current = null;
      }
    };
  }, [expandingSheet, navigate]);

  // Keyboard navigation when focused anywhere outside inputs/textareas/modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (expandingSheet || shelfItems.length === 0) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepBy(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepBy(-1);
      } else if (
        (e.key === 'Enter' || e.key === ' ') &&
        activePrompt &&
        stageRef.current?.contains(document.activeElement)
      ) {
        e.preventDefault();
        openPromptDetail(activePrompt);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePrompt, expandingSheet, openPromptDetail, shelfItems.length, stepBy]);

  // Horizontal wheel scroll navigation
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (shelfItems.length <= 1) return;
    const horizontalIntent = Math.abs(e.deltaX) > Math.abs(e.deltaY) * 0.9 || e.shiftKey;
    if (!horizontalIntent) return;

    const deltaMagnitude = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(deltaMagnitude) < 16) return;

    e.preventDefault();
    const now = Date.now();
    if (now - lastWheelNavRef.current < 260) return;
    lastWheelNavRef.current = now;
    stepBy(deltaMagnitude > 0 ? 1 : -1);
  };

  // Pointer drag & touch swipe navigation
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    pointerDragRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      hasMoved: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerDragRef.current.active) return;
    const dx = e.clientX - pointerDragRef.current.startX;
    const dy = e.clientY - pointerDragRef.current.startY;
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      pointerDragRef.current.hasMoved = true;
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerDragRef.current.active) return;
    const dx = e.clientX - pointerDragRef.current.startX;
    const dy = e.clientY - pointerDragRef.current.startY;
    const wasSwipe = pointerDragRef.current.hasMoved && Math.abs(dx) > Math.abs(dy);
    pointerDragRef.current.active = false;

    if (wasSwipe) {
      const step = resolveSwipeStep(dx, 38);
      if (step !== 0) {
        stepBy(step);
      }
    }

    window.setTimeout(() => {
      pointerDragRef.current.hasMoved = false;
    }, 0);
  };

  // Fine-pointer cursor tilt tracking on active artwork card
  const handleActiveCardPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (prefersReducedMotion || viewportWidth < 768 || e.pointerType === 'touch') return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    targetTiltRef.current = {
      x: Number((-ny * 8.5).toFixed(2)),
      y: Number((nx * 10.5).toFixed(2)),
    };
  };

  const handleActiveCardPointerLeave = () => {
    targetTiltRef.current = { x: 0, y: 0 };
  };

  // Responsive card dimensions preserving exact 9:16 portrait ratio
  const cardWidth =
    viewportWidth < 400
      ? 188
      : viewportWidth < 640
        ? 210
        : viewportWidth < 1024
          ? 248
          : 276;
  const stageHeight = Math.round(cardWidth * (16 / 9)) + (viewportWidth < 640 ? 42 : 68);

  return (
    <section
      aria-label="ImageLab Interactive 3D Artwork Shelf"
      className="relative overflow-x-clip border-b border-[#264653]/12 bg-[#F4EDE4]"
    >
      {/* Subtle architectural paper grid backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(250,247,242,0.92)_0%,rgba(244,237,228,0.65)_58%,rgba(232,222,200,0.45)_100%)]"
      />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-7 sm:pt-10 pb-10 sm:pb-14">
        {/* Editorial Studio Masthead */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 pb-6 border-b border-[#264653]/10">
          <div className="max-w-2xl">
            <p className="text-[11px] font-display font-bold uppercase tracking-[0.2em] text-[#2A9D8F] mb-2">
              ImageLab · Interactive AI Art Shelf
            </p>
            <h1 className="text-3xl sm:text-4xl lg:text-[2.85rem] font-extrabold tracking-tight text-[#264653] leading-[1.06] text-balance">
              Discover the Art Behind Every AI Image.
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <Link
              to="/explore"
              data-cursor="control"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] text-white text-sm font-semibold transition-colors whitespace-nowrap min-h-[42px] shadow-xs"
            >
              <span>Explore All Prompts</span>
              <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
            </Link>
            <Link
              to="/publish"
              data-cursor="control"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#FAF7F2] border border-[#264653]/15 hover:border-[#2A9D8F] text-[#264653] text-sm font-semibold transition-colors whitespace-nowrap min-h-[42px]"
            >
              <Plus className="w-4 h-4 text-[#2A9D8F]" aria-hidden="true" />
              <span>Share Creation</span>
            </Link>
          </div>
        </div>

        {/* Dynamic Category Tabs with Sliding Colored Indicator */}
        {categories.length > 0 && activeCategory && (
          <div className="pt-5 pb-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative overflow-x-auto no-scrollbar max-w-full">
              <div
                ref={tabListRef}
                role="tablist"
                aria-label="Filter shelf by collection"
                className="relative inline-flex items-center gap-1 sm:gap-2 pb-2"
              >
                {categories.map((cat) => {
                  const selected = cat.id === activeCategory.id;
                  return (
                    <button
                      key={cat.id}
                      ref={(el) => {
                        tabButtonRefs.current[cat.id] = el;
                      }}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      data-cursor="control"
                      onClick={() => {
                        setSelectedCategoryId(cat.id);
                        setActiveIndex(0);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors ${
                        selected
                          ? 'text-[#264653]'
                          : 'text-[#264653]/58 hover:text-[#264653]'
                      }`}
                    >
                      <span>{cat.label}</span>
                      <span className="ml-1.5 text-[11px] font-sans font-medium tabular-nums text-[#264653]/45">
                        {cat.items.length}
                      </span>
                    </button>
                  );
                })}

                <span
                  aria-hidden="true"
                  style={{
                    transform: `translate3d(${tabIndicator.left}px, 0, 0)`,
                    width: `${tabIndicator.width}px`,
                    backgroundColor: activeCategory.accentColor,
                    opacity: tabIndicator.ready ? 1 : 0,
                  }}
                  className="pointer-events-none absolute bottom-0 left-0 h-[2.5px] rounded-full transition-[transform,width,background-color,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
                />
              </div>
            </div>

            {activePrompt && (
              <p className="text-xs font-sans font-semibold tabular-nums text-[#264653]/65 shrink-0">
                {String(safeActiveIndex + 1).padStart(2, '0')} /{' '}
                {String(shelfItems.length).padStart(2, '0')} Selected
              </p>
            )}
          </div>
        )}

        {/* Authentic Empty State if Firestore / Public Feed has Zero Artworks */}
        {shelfItems.length === 0 || !activePrompt || !activeCreator ? (
          <div className="my-10 rounded-3xl bg-[#FAF7F2] border border-[#264653]/12 p-10 sm:p-14 text-center max-w-2xl mx-auto">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#2A9D8F] mb-2">
              Archive Waiting
            </p>
            <h2 className="text-2xl font-bold text-[#264653] mb-3">
              No Published Artworks Yet
            </h2>
            <p className="text-sm text-[#264653]/72 mb-6 leading-relaxed">
              The ImageLab gallery only showcases real published AI creations. Share the first piece to populate the 3D exhibition shelf.
            </p>
            <Link
              to="/publish"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#E76F51] hover:bg-[#D05A3C] text-white text-sm font-semibold transition-colors"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>Publish First Artwork</span>
            </Link>
          </div>
        ) : (
          <>
            {/* Interactive 3D Horizontal Shelf Stage */}
            <div
              ref={stageRef}
              tabIndex={0}
              role="region"
              aria-roledescription="3D artwork carousel"
              aria-label="Featured AI Artwork 3D Shelf. Use left or right arrow keys, swipe, or scroll horizontally to browse artworks."
              onWheel={handleWheel}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              style={{
                height: `${stageHeight}px`,
                perspective: viewportWidth < 640 ? '980px' : '1420px',
                touchAction: 'pan-y',
              }}
              className="relative mt-2 select-none outline-none focus-visible:ring-2 focus-visible:ring-[#2A9D8F]/40 rounded-3xl"
            >
              {/* Physical architectural shelf plinth line behind/underneath cards */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-4 sm:inset-x-10 bottom-4 h-10 rounded-full bg-gradient-to-b from-[#264653]/8 via-[#264653]/4 to-transparent blur-md"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-7 border-b border-[#264653]/12"
              />

              {/* Desktop Flanking Arrow Controls (placed in outer gutters away from focal artwork) */}
              {shelfItems.length > 1 && (
                <>
                  <button
                    type="button"
                    data-cursor="control"
                    onClick={() => stepBy(-1)}
                    aria-label="Previous artwork"
                    className="hidden md:inline-flex items-center justify-center w-11 h-11 rounded-full bg-[#FAF7F2]/95 border border-[#264653]/16 hover:border-[#E76F51] hover:bg-[#264653] text-[#264653] hover:text-[#FAF7F2] shadow-md transition-all absolute left-2 lg:left-4 top-1/2 -translate-y-1/2 z-40"
                  >
                    <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    data-cursor="control"
                    onClick={() => stepBy(1)}
                    aria-label="Next artwork"
                    className="hidden md:inline-flex items-center justify-center w-11 h-11 rounded-full bg-[#FAF7F2]/95 border border-[#264653]/16 hover:border-[#E76F51] hover:bg-[#264653] text-[#264653] hover:text-[#FAF7F2] shadow-md transition-all absolute right-2 lg:right-4 top-1/2 -translate-y-1/2 z-40"
                  >
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                </>
              )}

              {/* 3D Transform Cards Stage */}
              <div
                style={{ transformStyle: 'preserve-3d' }}
                className="relative w-full h-full flex items-center justify-center"
              >
                {shelfItems.map((item, idx) => {
                  const offset = computeShelfOffset(idx, safeActiveIndex, shelfItems.length);
                  const tx = computeShelfCardTransform(offset, {
                    cardWidth,
                    viewportWidth,
                    prefersReducedMotion,
                    tiltX: offset === 0 ? tilt.x : 0,
                    tiltY: offset === 0 ? tilt.y : 0,
                  });

                  const isNear = Math.abs(offset) <= 2;

                  return (
                    <div
                      key={item.id}
                      ref={tx.isActive ? activeCardRef : undefined}
                      data-cursor={tx.isActive ? 'active-card' : 'shelf-card'}
                      role="button"
                      tabIndex={tx.isActive ? 0 : -1}
                      aria-label={
                        tx.isActive
                          ? `Open ${item.title} details`
                          : `Focus ${item.title}`
                      }
                      aria-current={tx.isActive ? 'true' : undefined}
                      onPointerMove={tx.isActive ? handleActiveCardPointerMove : undefined}
                      onPointerLeave={tx.isActive ? handleActiveCardPointerLeave : undefined}
                      onClick={() => {
                        if (pointerDragRef.current.hasMoved) return;
                        if (tx.isActive) {
                          openPromptDetail(item);
                        } else {
                          setActiveIndex(idx);
                        }
                      }}
                      style={{
                        width: `${cardWidth}px`,
                        transform: `translate3d(${tx.translateX}px, 0, ${tx.translateZ}px) scale(${tx.scale}) rotateY(${tx.rotateY}deg) rotateX(${tx.rotateX}deg)`,
                        opacity: tx.opacity,
                        zIndex: tx.zIndex,
                        pointerEvents: tx.visible ? 'auto' : 'none',
                        willChange: tx.visible ? 'transform, opacity' : 'auto',
                        transition: tx.isActive
                          ? 'transform 480ms cubic-bezier(0.16, 1, 0.3, 1), opacity 360ms ease'
                          : 'transform 520ms cubic-bezier(0.16, 1, 0.3, 1), opacity 400ms ease',
                      }}
                      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[53%] cursor-pointer focus-visible:outline-none"
                    >
                      <div
                        className={`relative w-full aspect-[9/16] rounded-[18px] overflow-hidden bg-[#FAF7F2] border transition-shadow duration-500 ${
                          tx.isActive
                            ? 'border-[#264653]/25 shadow-[0_34px_64px_-18px_rgba(38,70,83,0.42),0_12px_24px_-10px_rgba(231,111,81,0.18)] ring-1 ring-[#FAF7F2]/70'
                            : 'border-[#264653]/14 shadow-[0_18px_36px_-14px_rgba(38,70,83,0.24)]'
                        }`}
                      >
                        <SafeImage
                          src={item.imageUrl}
                          alt={item.title}
                          fallbackTitle={item.title}
                          loading={isNear ? 'eager' : 'lazy'}
                          decoding="async"
                          draggable={false}
                          className="w-full h-full object-cover pointer-events-none select-none"
                        />

                        {/* Subtle printed-paper sheen on active framed card */}
                        <div
                          aria-hidden="true"
                          className={`pointer-events-none absolute inset-0 transition-opacity duration-300 ${
                            tx.isActive
                              ? 'bg-gradient-to-tr from-[#264653]/12 via-transparent to-white/15 opacity-100'
                              : 'bg-[#264653]/14 opacity-60 hover:opacity-20'
                          }`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Active Artwork Editorial Caption & Dedicated Mobile/Desktop Controls */}
            <div className="mt-2 sm:mt-4 max-w-2xl mx-auto text-center space-y-3">
              {/* Masked Title Reveal */}
              <div className="overflow-hidden">
                <div ref={captionTitleMaskRef} key={`title-${activePrompt.id}`}>
                  <p className="text-xs font-sans font-semibold text-[#2A9D8F] mb-1">
                    @{activeCreator.username} · {getPrimaryCollectionLabel(activePrompt)} ·{' '}
                    <span className="tabular-nums text-[#264653]/60">
                      {activePrompt.createdAt}
                    </span>
                  </p>
                  <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-[#264653]">
                    {activePrompt.title}
                  </h2>
                </div>
              </div>

              {/* Masked Description & Controls */}
              <div className="overflow-hidden">
                <div
                  ref={captionMetaMaskRef}
                  key={`meta-${activePrompt.id}`}
                  className="space-y-4"
                >
                  <p className="text-xs sm:text-sm text-[#264653]/72 max-w-lg mx-auto leading-relaxed">
                    {formatPublicEditorialSubtitle(activePrompt)}
                  </p>

                  {/* Action Bar: Mobile Flanking Arrows + Open CTA (Never Covers Artwork) */}
                  <div className="flex items-center justify-center gap-3 pt-1">
                    {shelfItems.length > 1 && (
                      <button
                        type="button"
                        data-cursor="control"
                        onClick={() => stepBy(-1)}
                        aria-label="Previous artwork"
                        className="md:hidden inline-flex items-center justify-center w-11 h-11 rounded-xl bg-[#FAF7F2] border border-[#264653]/16 text-[#264653] active:scale-95 transition-transform"
                      >
                        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                      </button>
                    )}

                    <button
                      type="button"
                      data-cursor="control"
                      onClick={() => openPromptDetail(activePrompt)}
                      className="inline-flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl bg-[#264653] hover:bg-[#E76F51] text-[#FAF7F2] text-xs sm:text-sm font-display font-bold tracking-[0.12em] uppercase shadow-sm transition-colors min-h-[44px] whitespace-nowrap"
                    >
                      <span>OPEN</span>
                      <span className="text-[#FAF7F2]/60 font-sans font-medium tracking-normal normal-case tabular-nums">
                        {String(safeActiveIndex + 1).padStart(2, '0')} /{' '}
                        {String(shelfItems.length).padStart(2, '0')}
                      </span>
                      <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
                    </button>

                    {shelfItems.length > 1 && (
                      <button
                        type="button"
                        data-cursor="control"
                        onClick={() => stepBy(1)}
                        aria-label="Next artwork"
                        className="md:hidden inline-flex items-center justify-center w-11 h-11 rounded-xl bg-[#FAF7F2] border border-[#264653]/16 text-[#264653] active:scale-95 transition-transform"
                      >
                        <ArrowRight className="w-4 h-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Expanding Physical Sheet Opening Portal Transition */}
      {expandingSheet &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            aria-hidden="true"
            className="fixed inset-0 z-[70] pointer-events-none bg-[#264653]/15"
          >
            <div
              ref={portalSheetRef}
              style={{
                top: `${expandingSheet.rect.top}px`,
                left: `${expandingSheet.rect.left}px`,
                width: `${expandingSheet.rect.width}px`,
                height: `${expandingSheet.rect.height}px`,
              }}
              className="fixed overflow-hidden bg-[#F4EDE4] shadow-2xl flex items-center justify-center"
            >
              <SafeImage
                src={expandingSheet.prompt.imageUrl}
                alt=""
                className="w-full h-full object-cover opacity-20"
              />
              <div className="absolute inset-0 bg-[#F4EDE4]/82" />
            </div>
          </div>,
          document.body
        )}
    </section>
  );
}
