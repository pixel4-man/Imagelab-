import { useEffect, useRef, useState } from 'react';

export type CursorMode = 'default' | 'shelf-card' | 'active-card' | 'control' | 'hidden';

interface LandingCursorProps {
  active?: boolean;
  onModeChange?: (mode: CursorMode) => void;
}

export function isFinePointerDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

export function LandingCursor({ active = true, onModeChange }: LandingCursorProps) {
  const ringRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);

  const [enabled, setEnabled] = useState(false);
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<CursorMode>('default');

  const pointerTarget = useRef({ x: -120, y: -120 });
  const ringPos = useRef({ x: -120, y: -120 });
  const hasPointer = useRef(false);
  const rafId = useRef<number | null>(null);
  const modeRef = useRef<CursorMode>('default');

  useEffect(() => {
    if (!active || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      setEnabled(false);
      return;
    }

    const pointerMq = window.matchMedia('(hover: hover) and (pointer: fine)');
    const syncPointerSupport = () => {
      setEnabled(pointerMq.matches);
    };
    syncPointerSupport();

    const handleTouchDisable = () => {
      setEnabled(false);
      setVisible(false);
    };

    pointerMq.addEventListener?.('change', syncPointerSupport);
    window.addEventListener('touchstart', handleTouchDisable, { passive: true });

    return () => {
      pointerMq.removeEventListener?.('change', syncPointerSupport);
      window.removeEventListener('touchstart', handleTouchDisable);
    };
  }, [active]);

  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);

  useEffect(() => {
    if (!enabled) {
      document.documentElement.removeAttribute('data-imagelab-cursor');
      return;
    }

    document.documentElement.setAttribute('data-imagelab-cursor', 'fine');

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const resolveTargetMode = (target: EventTarget | null): CursorMode => {
      if (!(target instanceof Element)) return 'default';
      if (target.closest('iframe, [data-ad-slot] iframe, [data-cursor="hidden"]')) {
        return 'hidden';
      }
      const declared = target.closest('[data-cursor]')?.getAttribute('data-cursor');
      if (
        declared === 'active-card' ||
        declared === 'shelf-card' ||
        declared === 'control' ||
        declared === 'hidden'
      ) {
        return declared;
      }
      if (target.closest('a, button, [role="tab"], [role="button"], input, select, textarea')) {
        return 'control';
      }
      return 'default';
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        setVisible(false);
        return;
      }
      pointerTarget.current.x = event.clientX;
      pointerTarget.current.y = event.clientY;
      if (!hasPointer.current) {
        ringPos.current.x = event.clientX;
        ringPos.current.y = event.clientY;
        hasPointer.current = true;
      }
      setVisible(true);

      const nextMode = resolveTargetMode(event.target);
      if (nextMode !== modeRef.current) {
        modeRef.current = nextMode;
        setMode(nextMode);
      }
    };

    const handlePointerLeave = () => {
      setVisible(false);
    };

    const tick = () => {
      const ease = reducedMotion ? 1 : 0.22;
      ringPos.current.x += (pointerTarget.current.x - ringPos.current.x) * ease;
      ringPos.current.y += (pointerTarget.current.y - ringPos.current.y) * ease;

      if (ringRef.current) {
        ringRef.current.style.transform = `translate3d(${ringPos.current.x}px, ${ringPos.current.y}px, 0) translate(-50%, -50%)`;
      }
      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${pointerTarget.current.x}px, ${pointerTarget.current.y}px, 0) translate(-50%, -50%)`;
      }
      rafId.current = window.requestAnimationFrame(tick);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.addEventListener('mouseleave', handlePointerLeave);
    window.addEventListener('blur', handlePointerLeave);
    rafId.current = window.requestAnimationFrame(tick);

    return () => {
      document.documentElement.removeAttribute('data-imagelab-cursor');
      window.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('mouseleave', handlePointerLeave);
      window.removeEventListener('blur', handlePointerLeave);
      if (rafId.current !== null) {
        window.cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
    };
  }, [enabled]);

  if (!enabled) return null;

  const isHidden = !visible || mode === 'hidden';
  const sizeClass =
    mode === 'active-card'
      ? 'w-[76px] h-[76px] bg-[#264653] border-[#264653] shadow-[0_14px_30px_-8px_rgba(38,70,83,0.45)]'
      : mode === 'shelf-card'
        ? 'w-9 h-9 bg-[#2A9D8F]/12 border-[#2A9D8F]/75'
        : mode === 'control'
          ? 'w-7 h-7 bg-[#E76F51]/10 border-[#E76F51]/75'
          : 'w-[58px] h-[58px] bg-transparent border-[#264653]/40';

  return (
    <div
      aria-hidden="true"
      data-testid="landing-custom-cursor"
      className="fixed inset-0 pointer-events-none z-50 overflow-hidden"
    >
      <div
        ref={ringRef}
        style={{ willChange: 'transform, opacity' }}
        className={`fixed top-0 left-0 rounded-full border-[1.5px] flex items-center justify-center transition-[width,height,background-color,border-color,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${sizeClass} ${
          isHidden ? 'opacity-0 scale-75' : 'opacity-100 scale-100'
        }`}
      >
        <span
          ref={labelRef}
          className={`font-display text-[10px] font-extrabold tracking-[0.18em] text-[#FAF7F2] uppercase select-none transition-opacity duration-150 ${
            mode === 'active-card' && !isHidden ? 'opacity-100' : 'opacity-0'
          }`}
        >
          OPEN
        </span>
      </div>

      <div
        ref={dotRef}
        style={{ willChange: 'transform, opacity' }}
        className={`fixed top-0 left-0 w-1.5 h-1.5 rounded-full bg-[#E76F51] transition-opacity duration-150 ${
          isHidden || mode === 'active-card' ? 'opacity-0' : 'opacity-100'
        }`}
      />
    </div>
  );
}
