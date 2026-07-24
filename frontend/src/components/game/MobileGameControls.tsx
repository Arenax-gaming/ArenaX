"use client";

import { useState, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { useDevice, useVibration } from "@/hooks/useMobile";
import { useSwipeGesture } from "@/hooks/useSwipeGesture";
import { SkillQuickAccessBar } from "@/components/game/SkillQuickAccessBar";

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
        // Guaranteed minimum 44x44px touch target (w-24 h-24 = 96x96px)
        "relative w-24 h-24 min-w-[44px] min-h-[44px] rounded-full bg-background/60 backdrop-blur-md border-2 border-border/80",
        "flex items-center justify-center touch-none select-none shadow-lg",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      aria-label="Virtual Movement Joystick"
    >
      {/* Outer ring */}
      <div className="absolute inset-1 rounded-full border border-muted-foreground/30 pointer-events-none" />

      {/* Joystick knob */}
      <div
        className={cn(
          "w-12 h-12 min-w-[44px] min-h-[44px] rounded-full bg-primary transition-transform pointer-events-none",
          "shadow-xl border border-primary-foreground/20",
          isActive && "scale-110 bg-primary/90"
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

  // Guaranteed minimum 44x44px for accessibility across all size settings
  const sizeClasses = {
    small: "w-12 h-12 min-w-[44px] min-h-[44px] text-sm",
    medium: "w-16 h-16 min-w-[44px] min-h-[44px] text-base",
    large: "w-20 h-20 min-w-[44px] min-h-[44px] text-lg",
  };

  const variantClasses = {
    primary: "bg-primary text-primary-foreground shadow-primary/20",
    secondary: "bg-secondary text-secondary-foreground shadow-secondary/20",
    danger: "bg-destructive text-destructive-foreground shadow-destructive/20",
  };

  return (
    <button
      className={cn(
        "rounded-full font-semibold transition-all shadow-md select-none touch-none",
        "flex items-center justify-center gap-1",
        "active:scale-95 active:opacity-80 focus:outline-none focus:ring-2 focus:ring-primary",
        sizeClasses[size],
        variantClasses[variant],
        disabled && "opacity-50 cursor-not-allowed",
        isPressed && "scale-95 opacity-90"
      )}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      disabled={disabled}
      aria-label={`Action ${label}`}
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
        "fixed inset-0 pointer-events-none z-50 flex flex-col justify-between p-3 sm:p-6",
        isLandscape ? "flex-row flex-wrap" : "flex-col-reverse gap-4"
      )}
    >
      {/* Top Bar - Pause & Header HUD */}
      <div className="pointer-events-auto w-full flex items-center justify-between gap-2">
        {/* Integrated Skill Quick Access Bar */}
        <SkillQuickAccessBar
          mobileCompact
          disabled={disabled}
          className="pointer-events-auto shadow-lg max-w-[calc(100%-60px)]"
        />

        <button
          className="w-12 h-12 min-w-[44px] min-h-[44px] rounded-full bg-background/80 backdrop-blur border border-border/60 flex items-center justify-center shadow-lg active:scale-95"
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

      {/* Bottom Controls Area: Joystick & Action Buttons */}
      <div
        className={cn(
          "pointer-events-auto w-full flex items-end justify-between gap-4",
          isLandscape ? "flex-row items-end" : "flex-row items-end"
        )}
      >
        {/* Left side - Movement Joystick */}
        <div className="flex items-center justify-center p-2">
          <VirtualJoystick
            onMove={handleMove}
            onRelease={handleRelease}
            disabled={disabled}
          />
        </div>

        {/* Right side - Action Buttons */}
        <div className="flex gap-2 sm:gap-4 flex-wrap justify-end items-end">
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