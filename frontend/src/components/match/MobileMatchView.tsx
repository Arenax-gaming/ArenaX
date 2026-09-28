"use client";

/**
 * MobileMatchView — issue #928.
 *
 * A touch-first wrapper around a live match / game board that layers the mobile
 * gestures called for in the acceptance criteria on top of arbitrary board
 * content passed as `children`:
 *
 *  - **Swipe left / right** — navigate between matches (or any caller action).
 *  - **Pinch-to-zoom** — two-finger zoom on the game board, double-tap to reset.
 *  - **Long-press** — opens a context menu at the touch point.
 *  - **Haptic feedback** — short vibrations on gesture activation (where the
 *    Vibration API is available).
 *  - **Gesture customization** — every gesture can be toggled and tuned; the
 *    settings persist to localStorage and can be seeded / overridden by props.
 *
 * Every gesture has an accessible, non-touch fallback (buttons / menu) so the
 * view remains usable with a keyboard or pointer and is straightforward to test.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Settings2,
  MoreVertical,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDevice, useVibration } from "@/hooks/useMobile";
import { useSwipeGesture, useLongPress, useDoubleTap } from "@/hooks/useSwipeGesture";

// ─── Configuration ────────────────────────────────────────────────────────────

export interface GestureConfig {
  swipeEnabled: boolean;
  pinchEnabled: boolean;
  longPressEnabled: boolean;
  hapticsEnabled: boolean;
  /** Minimum travel (px) before a swipe registers. */
  swipeThreshold: number;
  /** Hold time (ms) before a long-press fires. */
  longPressDuration: number;
  /** Zoom clamp. */
  minZoom: number;
  maxZoom: number;
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  swipeEnabled: true,
  pinchEnabled: true,
  longPressEnabled: true,
  hapticsEnabled: true,
  swipeThreshold: 50,
  longPressDuration: 500,
  minZoom: 1,
  maxZoom: 3,
};

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

export interface MobileMatchViewProps {
  /** The game board / match content the gestures operate on. */
  children: React.ReactNode;
  /** Accessible label for the interactive surface. */
  label?: string;
  /** Swipe-left action (defaults to "next match"). */
  onSwipeLeft?: () => void;
  /** Swipe-right action (defaults to "previous match"). */
  onSwipeRight?: () => void;
  /** Human labels for the swipe affordance buttons. */
  swipeLeftLabel?: string;
  swipeRightLabel?: string;
  /** Items shown in the long-press context menu. */
  contextMenuItems?: ContextMenuItem[];
  /** Seed / override for the gesture configuration. */
  config?: Partial<GestureConfig>;
  /** Notified whenever the effective configuration changes. */
  onConfigChange?: (config: GestureConfig) => void;
  /** Notified on every zoom change (useful for analytics / sync). */
  onZoomChange?: (scale: number) => void;
  /** localStorage key for persisted customization. Pass null to disable. */
  storageKey?: string | null;
  className?: string;
}

const DEFAULT_STORAGE_KEY = "arenax:match-gestures";

// Distance between the first two active touch points.
function touchDistance(touches: React.TouchList | TouchList): number {
  if (touches.length < 2) return 0;
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

// ─── Component ──────────────────────────────────────────────────────────────

export function MobileMatchView({
  children,
  label = "Match view",
  onSwipeLeft,
  onSwipeRight,
  swipeLeftLabel = "Next match",
  swipeRightLabel = "Previous match",
  contextMenuItems = [],
  config: configProp,
  onConfigChange,
  onZoomChange,
  storageKey = DEFAULT_STORAGE_KEY,
  className,
}: MobileMatchViewProps) {
  const { isTouchDevice } = useDevice();
  const { vibrate } = useVibration();

  // Effective config: defaults ← caller overrides ← persisted customization.
  const [config, setConfig] = useState<GestureConfig>(() => {
    const seeded = { ...DEFAULT_GESTURE_CONFIG, ...configProp };
    if (!storageKey || typeof window === "undefined") return seeded;
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? { ...seeded, ...JSON.parse(raw) } : seeded;
    } catch {
      return seeded;
    }
  });

  const [zoom, setZoom] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const lastPointRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // Pinch bookkeeping.
  const pinchStartDist = useRef(0);
  const pinchStartZoom = useRef(1);
  const isPinching = useRef(false);

  const haptic = useCallback(
    (pattern: number | number[] = 10) => {
      if (config.hapticsEnabled) vibrate(pattern);
    },
    [config.hapticsEnabled, vibrate]
  );

  const updateConfig = useCallback(
    (patch: Partial<GestureConfig>) => {
      setConfig((prev) => {
        const next = { ...prev, ...patch };
        if (storageKey && typeof window !== "undefined") {
          try {
            window.localStorage.setItem(storageKey, JSON.stringify(next));
          } catch {
            /* persistence is best-effort */
          }
        }
        onConfigChange?.(next);
        return next;
      });
    },
    [storageKey, onConfigChange]
  );

  const applyZoom = useCallback(
    (next: number) => {
      const clamped = clamp(
        Number(next.toFixed(3)),
        config.minZoom,
        config.maxZoom
      );
      setZoom((prev) => {
        if (prev === clamped) return prev;
        // Buzz when bumping against a zoom limit.
        if (clamped === config.minZoom || clamped === config.maxZoom) haptic(8);
        onZoomChange?.(clamped);
        return clamped;
      });
    },
    [config.minZoom, config.maxZoom, haptic, onZoomChange]
  );

  const resetZoom = useCallback(() => {
    setZoom((prev) => {
      if (prev === 1) return prev;
      onZoomChange?.(1);
      return 1;
    });
  }, [onZoomChange]);

  // ── Swipe ──
  const handleSwipeLeft = useCallback(() => {
    if (!config.swipeEnabled || !onSwipeLeft) return;
    haptic(12);
    onSwipeLeft();
  }, [config.swipeEnabled, onSwipeLeft, haptic]);

  const handleSwipeRight = useCallback(() => {
    if (!config.swipeEnabled || !onSwipeRight) return;
    haptic(12);
    onSwipeRight();
  }, [config.swipeEnabled, onSwipeRight, haptic]);

  const swipe = useSwipeGesture({
    threshold: config.swipeThreshold,
    onSwipeLeft: handleSwipeLeft,
    onSwipeRight: handleSwipeRight,
    // Only single-finger horizontal swipes should act; disable while pinching.
    enabled: config.swipeEnabled,
  });

  // ── Long-press → context menu ──
  const openMenu = useCallback(() => {
    if (!config.longPressEnabled || contextMenuItems.length === 0) return;
    haptic([10, 30, 10]);
    setMenu({ ...lastPointRef.current });
  }, [config.longPressEnabled, contextMenuItems.length, haptic]);

  const longPress = useLongPress(openMenu, config.longPressDuration);

  // ── Double-tap → reset zoom ──
  const handleDoubleTap = useDoubleTap(() => {
    if (config.pinchEnabled) resetZoom();
  });

  // ── Merged touch handlers (swipe + long-press + pinch on one surface) ──
  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (touch) lastPointRef.current = { x: touch.clientX, y: touch.clientY };

      if (config.pinchEnabled && e.touches.length >= 2) {
        // Two fingers → pinch. Suppress swipe/long-press.
        isPinching.current = true;
        pinchStartDist.current = touchDistance(e.touches);
        pinchStartZoom.current = zoom;
        longPress.onTouchEnd();
        return;
      }
      isPinching.current = false;
      swipe.handleTouchStart(e);
      if (config.longPressEnabled) longPress.onTouchStart();
    },
    [config.pinchEnabled, config.longPressEnabled, zoom, swipe, longPress]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (isPinching.current && e.touches.length >= 2) {
        if (pinchStartDist.current > 0) {
          const ratio = touchDistance(e.touches) / pinchStartDist.current;
          applyZoom(pinchStartZoom.current * ratio);
        }
        // A moving pinch is not a long-press.
        longPress.onTouchMove();
        return;
      }
      swipe.handleTouchMove(e);
      longPress.onTouchMove();
    },
    [applyZoom, swipe, longPress]
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (isPinching.current) {
        // End the pinch only once the second finger lifts.
        if (e.touches.length < 2) isPinching.current = false;
        return;
      }
      swipe.handleTouchEnd();
      longPress.onTouchEnd();
      handleDoubleTap();
    },
    [swipe, longPress, handleDoubleTap]
  );

  // Close menu on Escape / outside interaction.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  const canZoom = config.pinchEnabled;
  const zoomPct = Math.round(zoom * 100);

  const toggles = useMemo(
    () =>
      [
        { key: "swipeEnabled", label: "Swipe navigation" },
        { key: "pinchEnabled", label: "Pinch to zoom" },
        { key: "longPressEnabled", label: "Long-press menu" },
        { key: "hapticsEnabled", label: "Haptic feedback" },
      ] as const,
    []
  );

  return (
    <div className={cn("relative flex flex-col gap-3", className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleSwipeRight}
            disabled={!config.swipeEnabled || !onSwipeRight}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-foreground disabled:opacity-40 active:scale-95"
            aria-label={swipeRightLabel}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={handleSwipeLeft}
            disabled={!config.swipeEnabled || !onSwipeLeft}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-foreground disabled:opacity-40 active:scale-95"
            aria-label={swipeLeftLabel}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex items-center gap-1">
          {canZoom && (
            <>
              <button
                type="button"
                onClick={() => applyZoom(zoom - 0.25)}
                disabled={zoom <= config.minZoom}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-foreground disabled:opacity-40 active:scale-95"
                aria-label="Zoom out"
              >
                <ZoomOut className="h-4 w-4" aria-hidden="true" />
              </button>
              <span
                className="min-w-[3.25rem] text-center text-xs tabular-nums text-muted-foreground"
                aria-label={`Zoom ${zoomPct} percent`}
              >
                {zoomPct}%
              </span>
              <button
                type="button"
                onClick={() => applyZoom(zoom + 0.25)}
                disabled={zoom >= config.maxZoom}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-foreground disabled:opacity-40 active:scale-95"
                aria-label="Zoom in"
              >
                <ZoomIn className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={resetZoom}
                disabled={zoom === 1}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-foreground disabled:opacity-40 active:scale-95"
                aria-label="Reset zoom"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
              </button>
            </>
          )}
          {contextMenuItems.length > 0 && (
            <button
              type="button"
              onClick={openMenu}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-foreground active:scale-95"
              aria-label="Match actions"
              aria-haspopup="menu"
            >
              <MoreVertical className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowSettings((s) => !s)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-background text-foreground active:scale-95"
            aria-label="Gesture settings"
            aria-expanded={showSettings}
          >
            <Settings2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Interactive board surface */}
      <div
        ref={surfaceRef}
        role="group"
        aria-label={label}
        data-testid="gesture-surface"
        className="relative touch-none select-none overflow-hidden rounded-lg border bg-muted/30"
        style={{ touchAction: canZoom ? "none" : "pan-y" }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onContextMenu={(e) => {
          // Mouse right-click mirrors long-press.
          if (config.longPressEnabled && contextMenuItems.length > 0) {
            e.preventDefault();
            lastPointRef.current = { x: e.clientX, y: e.clientY };
            openMenu();
          }
        }}
      >
        <div
          data-testid="zoom-layer"
          className="origin-center transition-transform duration-75 ease-out will-change-transform"
          style={{ transform: `scale(${zoom})` }}
        >
          {children}
        </div>

        {isTouchDevice && (
          <p className="pointer-events-none absolute inset-x-0 bottom-1 text-center text-[10px] text-muted-foreground/70">
            Swipe to navigate · pinch to zoom · long-press for actions
          </p>
        )}
      </div>

      {/* Long-press / right-click context menu */}
      {menu && (
        <>
          <div
            className="fixed inset-0 z-40"
            aria-hidden="true"
            onClick={() => setMenu(null)}
            onTouchStart={() => setMenu(null)}
          />
          <ul
            role="menu"
            aria-label="Match actions"
            className="fixed z-50 min-w-[10rem] overflow-hidden rounded-md border bg-popover p-1 shadow-lg"
            style={{
              top: clamp(menu.y, 8, (typeof window !== "undefined" ? window.innerHeight : 800) - 8),
              left: clamp(menu.x, 8, (typeof window !== "undefined" ? window.innerWidth : 400) - 8),
            }}
          >
            {contextMenuItems.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.id} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => {
                      setMenu(null);
                      haptic(8);
                      item.onSelect();
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-40",
                      item.destructive
                        ? "text-destructive hover:bg-destructive/10"
                        : "text-foreground"
                    )}
                  >
                    {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* Gesture customization panel */}
      {showSettings && (
        <div
          role="region"
          aria-label="Gesture settings"
          className="rounded-lg border bg-background p-4 shadow-sm"
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Gesture settings</h3>
            <button
              type="button"
              onClick={() => setShowSettings(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close gesture settings"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="space-y-2">
            {toggles.map(({ key, label: toggleLabel }) => (
              <label
                key={key}
                className="flex items-center justify-between gap-4 text-sm"
              >
                <span>{toggleLabel}</span>
                <input
                  type="checkbox"
                  checked={config[key]}
                  onChange={(e) => updateConfig({ [key]: e.target.checked })}
                  className="h-4 w-4 accent-primary"
                  aria-label={toggleLabel}
                />
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default MobileMatchView;
