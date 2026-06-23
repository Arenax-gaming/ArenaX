'use client';

import React, {
  createContext,
  useContext,
  useEffect,
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

  const setOpen = (v: boolean) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (v) {
      timerRef.current = setTimeout(() => setOpenRaw(true), delayMs);
    } else {
      setOpenRaw(false);
    }
  };

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <TooltipContext.Provider value={{ open, setOpen, placement, triggerRef }}>
      <span className="relative inline-flex">{children}</span>
    </TooltipContext.Provider>
  );
}

export interface TooltipTriggerProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
}

export function TooltipTrigger({ children, ...props }: TooltipTriggerProps) {
  const { setOpen, triggerRef } = useTooltipContext();
  return (
    <span
      ref={triggerRef as React.RefObject<HTMLSpanElement>}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      aria-describedby={undefined}
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
  const { open, placement } = useTooltipContext();
  const id = useRef(`tt-${Math.random().toString(36).slice(2)}`);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          id={id.current}
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
