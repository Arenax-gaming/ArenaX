'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/lib/utils';

type Placement = 'top' | 'bottom' | 'left' | 'right';

interface TooltipContextValue {
  open: boolean;
  setOpen: (v: boolean) => void;
  placement: Placement;
  triggerRef: React.RefObject<HTMLElement>;
  /** Stable id shared between trigger (aria-describedby) and content (id). */
  contentId: string;
}

const TooltipContext = createContext<TooltipContextValue | null>(null);

function useTooltipContext() {
  const ctx = useContext(TooltipContext);
  if (!ctx) throw new Error('Tooltip compound components must be used inside <Tooltip>');
  return ctx;
}

export interface TooltipProps {
  children: React.ReactNode;
  placement?: Placement;
  /** Delay in ms before showing (default 200). */
  delayMs?: number;
}

export function Tooltip({ children, placement = 'top', delayMs = 200 }: TooltipProps) {
  const [open, setOpenRaw] = useState(false);
  const triggerRef = useRef<HTMLElement>(null!);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // useId produces a stable, unique id per component instance (React 18+).
  const contentId = useId();

  const setOpen = (v: boolean) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (v) {
      timerRef.current = setTimeout(() => setOpenRaw(true), delayMs);
    } else {
      // Cancel a pending open before closing immediately.
      setOpenRaw(false);
    }
  };

  // Close on Escape regardless of which element holds focus (WCAG 1.4.13).
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpenRaw(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <TooltipContext.Provider value={{ open, setOpen, placement, triggerRef, contentId }}>
      <span className="relative inline-flex">{children}</span>
    </TooltipContext.Provider>
  );
}

export interface TooltipTriggerProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
}

export function TooltipTrigger({ children, ...props }: TooltipTriggerProps) {
  const { setOpen, triggerRef, open, contentId } = useTooltipContext();
  return (
    <span
      ref={triggerRef as React.RefObject<HTMLSpanElement>}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      // Link the trigger to the tooltip content for screen readers.
      aria-describedby={open ? contentId : undefined}
      {...props}
    >
      {children}
    </span>
  );
}

const PLACEMENT_CLASSES: Record<Placement, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
};

const PLACEMENT_INITIAL: Record<Placement, object> = {
  top: { opacity: 0, y: 4 },
  bottom: { opacity: 0, y: -4 },
  left: { opacity: 0, x: 4 },
  right: { opacity: 0, x: -4 },
};

export interface TooltipContentProps {
  children: React.ReactNode;
  className?: string;
}

export function TooltipContent({ children, className }: TooltipContentProps) {
  const { open, placement, contentId } = useTooltipContext();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          id={contentId}
          role="tooltip"
          initial={PLACEMENT_INITIAL[placement]}
          animate={{ opacity: 1, x: 0, y: 0 }}
          exit={PLACEMENT_INITIAL[placement]}
          transition={{ duration: 0.12 }}
          className={cn(
            'absolute z-50 whitespace-nowrap rounded-md bg-gray-900 px-2.5 py-1.5 text-xs text-white shadow-md',
            PLACEMENT_CLASSES[placement],
            className,
          )}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
