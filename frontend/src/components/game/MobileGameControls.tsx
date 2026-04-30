// filepath: frontend/src/components/game/MobileGameControls.tsx
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useDevice, useVibration } from "@/hooks/useMobile";
import { useSwipeGesture } from "@/hooks/useSwipeGesture";

interface GameControlConfig {
  size?: "small" | "medium" | "large";
  showLabels?: boolean;
  hapticFeedback?: boolean;
}

interface Position {
  x: number;
  y: number;
}

// Virtual joystick for movement
interface VirtualJoystickProps {
  onMove: (x: number, y: number) => void;
  onRelease?: () => void;
  disabled?: boolean;
  className?: string;
}

function VirtualJoystick({
  onMove,
  onRelease,
  disabled = false,
  className,
}: VirtualJoystickProps) {
  const [isActive, setIsActive] = useState(false);
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 });
  const joystickRef = useRef<HTMLDivElement>(null);
  const centerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const maxDistance = 40;
  const { vibrate } = useVibration();

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();

      const rect = joystickRef.current?.getBoundingClientRect();
      if (!rect) return;

      setIsActive(true);
      centerRef.current = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };

      if (vibrate) vibrate(10);
    },
    [disabled, vibrate]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isActive || disabled) return;
      e.preventDefault();

      const touch = e.touches[0];
      const deltaX = touch.clientX - centerRef.current.x;
      const deltaY = touch.clientY - centerRef.current.y;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

      // Clamp to max distance
      const clampedDistance = Math.min(distance, maxDistance);
      const angle = Math.atan2(deltaY, deltaX);

      const clampedX = Math.cos(angle) * clampedDistance;
      const clampedY = Math.sin(angle) * clampedDistance;

      setPosition({ x: clampedX, y: clampedY });

      // Normalize to -1 to 1 range
      const normalizedX = clampedX / maxDistance;
      const normalizedY = clampedY / maxDistance;
      onMove(normalizedX, normalizedY);
    },
    [isActive, disabled, onMove]
  );

  const handleTouchEnd = useCallback(() => {
    setIsActive(false);
    setPosition({ x: 0, y: 0 });
    onMove(0, 0);
    onRelease?.();
  }, [onMove, onRelease]);

  return (
    <div
      ref={joystickRef}
      className={cn(
        "relative w-24 h-24 rounded-full bg-background/50 border-2 border-border",
        "flex items-center justify-center",
        disabled && "opacity-50",
        className
      )}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {/* Outer ring */}
      <div className="absolute inset-1 rounded-full border border-muted-foreground/20" />

      {/* Joystick knob */}
      <div
        className={cn(
          "w-12 h-12 rounded-full bg-primary transition-transform",
          "shadow-lg",
          isActive && "scale-110"
        )}
        style={{
          transform: `translate(${position.x}px, ${position.y}px)`,
        }}
      />
    </div>
  );
}

// Action buttons for game
interface ActionButtonProps {
  label: string;
  icon?: React.ReactNode;
  onPress: () => void;
  onRelease?: () => void;
  variant?: "primary" | "secondary" | "danger";
  size?: "small" | "medium" | "large";
  disabled?: boolean;
}

function ActionButton({
  label,
  icon,
  onPress,
  onRelease,
  variant = "primary",
  size = "medium",
  disabled = false,
}: ActionButtonProps) {
  const [isPressed, setIsPressed] = useState(false);
  const { vibrate } = useVibration();

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (disabled) return;
      e.preventDefault();
      setIsPressed(true);
      vibrate?.(15);
      onPress();
    },
    [disabled, onPress, vibrate]
  );

  const handleTouchEnd = useCallback(() => {
    setIsPressed(false);
    onRelease?.();
  }, [onRelease]);

  const sizeClasses = {
    small: "w-14 h-14 text-sm",
    medium: "w-16 h-16 text-base",
    large: "w-20 h-20 text-lg",
  };

  const variantClasses = {
    primary: "bg-primary text-primary-foreground",
    secondary: "bg-secondary text-secondary-foreground",
    danger: "bg-destructive text-destructive-foreground",
  };

  return (
    <button
      className={cn(
        "rounded-full font-semibold transition-all",
        "flex items-center justify-center gap-1",
        "active:scale-95 active:opacity-80",
        sizeClasses[size],
        variantClasses[variant],
        disabled && "opacity-50 cursor-not-allowed"
      )}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      disabled={disabled}
    >
      {icon}
      {label}
    </button>
  );
}

// Main mobile game controls component
interface MobileGameControlsProps {
  config?: GameControlConfig;
  onMove?: (x: number, y: number) => void;
  onJump?: () => void;
  onAttack?: () => void;
  onSpecial?: () => void;
  onPause?: () => void;
  disabled?: boolean;
}

export function MobileGameControls({
  config = {},
  onMove,
  onJump,
  onAttack,
  onSpecial,
  onPause,
  disabled = false,
}: MobileGameControlsProps) {
  const { isMobile, isLandscape } = useDevice();
  const [moveVector, setMoveVector] = useState<Position>({ x: 0, y: 0 });

  // Handle joystick movement
  const handleMove = useCallback(
    (x: number, y: number) => {
      setMoveVector({ x, y });
      onMove?.(x, y);
    },
    [onMove]
  );

  // Handle joystick release
  const handleRelease = useCallback(() => {
    setMoveVector({ x: 0, y: 0 });
    onMove?.(0, 0);
  }, [onMove]);

  // Track gesture for quick actions
  const { handleTouchStart: handleSwipeStart, handleTouchEnd: handleSwipeEnd } =
    useSwipeGesture({
      threshold: 30,
      onSwipeLeft: () => onSpecial?.(),
      onSwipeRight: () => onAttack?.(),
      onSwipeUp: () => onJump?.(),
      enabled: !disabled,
    });

  // Show controls only on mobile
  if (!isMobile) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed inset-0 pointer-events-none z-50",
        "flex flex-col justify-between",
        isLandscape ? "flex-row" : "flex-col-reverse"
      )}
    >
      {/* Top bar - pause button */}
      <div className="pointer-events-auto p-4 flex justify-end">
        <button
          className="w-12 h-12 rounded-full bg-background/80 backdrop-blur flex items-center justify-center"
          onClick={onPause}
          disabled={disabled}
          aria-label="Pause game"
        >
          <svg
            className="w-6 h-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </button>
      </div>

      {/* Bottom controls */}
      <div
        className={cn(
          "pointer-events-auto p-4",
          isLandscape ? "flex-row items-center" : "flex flex-col items-center gap-4"
        )}
      >
        {/* Left side - Movement joystick */}
        <div className={cn(isLandscape ? "order-1" : "order-2")}>
          <VirtualJoystick
            onMove={handleMove}
            onRelease={handleRelease}
            disabled={disabled}
          />
        </div>

        {/* Right side - Action buttons */}
        <div
          className={cn(
            "flex gap-3",
            isLandscape ? "flex-col" : "flex-row",
            isLandscape ? "order-2" : "order-1"
          )}
        >
          <ActionButton
            label="A"
            onPress={onAttack || (() => {})}
            variant="primary"
            size={config.size === "large" ? "large" : "medium"}
            disabled={disabled}
          />
          <ActionButton
            label="B"
            onPress={onSpecial || (() => {})}
            variant="secondary"
            size={config.size === "large" ? "large" : "medium"}
            disabled={disabled}
          />
          <ActionButton
            label="J"
            onPress={onJump || (() => {})}
            variant="primary"
            size={config.size === "large" ? "large" : "medium"}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}

export { VirtualJoystick, ActionButton };
export default MobileGameControls;