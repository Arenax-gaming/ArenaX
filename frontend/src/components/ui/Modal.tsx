"use client";

import { useEffect, useRef, useCallback, useState, useId } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { announce, getFocusableElements } from "@/lib/accessibility";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  /** Optional description, wired to `aria-describedby`. */
  description?: React.ReactNode;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  position?: "center" | "top" | "bottom";
  /** Close when the backdrop is clicked (default true). */
  closeOnOverlayClick?: boolean;
  /** Close on Escape (default true). */
  closeOnEscape?: boolean;
  showCloseButton?: boolean;
  className?: string;
  contentClassName?: string;
  /** Element to focus on open; defaults to the first focusable element. */
  initialFocusRef?: React.RefObject<HTMLElement>;
  /** Accessible name when there is no visible `title`. */
  ariaLabel?: string;
  /** Screen-reader announcement on open; defaults to "<title> dialog opened". */
  announcement?: string;
  /** `alertdialog` for confirmations that need a response. */
  role?: "dialog" | "alertdialog";
  /** Id of an element inside `children` that describes the dialog. */
  ariaDescribedBy?: string;
}

const sizeClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  full: "max-w-5xl",
};

const positionClasses = {
  center: "items-center justify-center",
  top: "items-start justify-center pt-20",
  bottom: "items-end justify-center pb-20",
};

// ─── Open-modal stack ─────────────────────────────────────────────────────────
// Only the top-most modal reacts to Tab / Escape, so pressing Escape in a
// nested dialog closes that dialog alone, and body scroll is unlocked only
// when the last modal closes.

const openModals: string[] = [];

function isTopModal(id: string) {
  return openModals[openModals.length - 1] === id;
}

/**
 * Accessible modal dialog (Issue #1327):
 * - `role="dialog"` / `aria-modal="true"`, labelled by its title (or
 *   `ariaLabel`) and described by `description`
 * - Tab / Shift+Tab are trapped inside the dialog; focus that lands outside
 *   (e.g. after a click on the page behind) is pulled back in
 * - Escape closes it (configurable) and focus returns to the element that
 *   opened it
 * - Backdrop click closes it (configurable)
 * - Opening is announced to screen readers through the shared live region
 * - Nested modals: only the top one handles keys
 * - Honours reduced-motion preferences
 */
export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  size = "md",
  position = "center",
  closeOnOverlayClick = true,
  closeOnEscape = true,
  showCloseButton = true,
  className,
  contentClassName,
  initialFocusRef,
  ariaLabel,
  announcement,
  role = "dialog",
  ariaDescribedBy,
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const prefersReducedMotion = useReducedMotion();
  const instanceId = useId();
  const titleId = `${instanceId}-title`;
  const descriptionId = `${instanceId}-description`;

  // Keep the latest onClose without re-running the open/close effect, so a
  // parent re-render never "closes and reopens" (and re-steals focus).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Open / close lifecycle: remember the trigger, register on the stack,
  // lock scroll, move focus in, announce; undo all of it on close/unmount.
  useEffect(() => {
    if (!isOpen) return;

    triggerRef.current = document.activeElement as HTMLElement | null;
    openModals.push(instanceId);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const frame = requestAnimationFrame(() => {
      const container = modalRef.current;
      if (!container) return;
      const target =
        initialFocusRef?.current ?? getFocusableElements(container)[0] ?? container;
      target.focus();
    });

    const label = title ?? ariaLabel;
    announce(announcement ?? (label ? `${label} dialog opened` : "Dialog opened"));

    return () => {
      cancelAnimationFrame(frame);
      const index = openModals.lastIndexOf(instanceId);
      if (index !== -1) openModals.splice(index, 1);
      if (openModals.length === 0) {
        document.body.style.overflow = previousOverflow;
      }
      // Return focus to whatever opened the dialog, if it is still on the page.
      const trigger = triggerRef.current;
      if (trigger && document.contains(trigger)) {
        trigger.focus();
      }
    };
    // Title / label changes while open shouldn't re-run the lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, instanceId]);

  // Keyboard: Escape + focus trap, for the top-most modal only.
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopModal(instanceId)) return;
      const container = modalRef.current;
      if (!container) return;

      if (event.key === "Escape") {
        if (closeOnEscape) {
          event.preventDefault();
          event.stopPropagation();
          onCloseRef.current();
        }
        return;
      }

      if (event.key !== "Tab") return;

      // Re-query every time: content can change while the dialog is open.
      const focusable = getFocusableElements(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      const outside = !active || !container.contains(active);

      if (event.shiftKey) {
        if (outside || active === first || active === container) {
          event.preventDefault();
          last.focus();
        }
      } else if (outside || active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // Pull focus back if something outside the dialog receives it.
    const handleFocusIn = (event: FocusEvent) => {
      if (!isTopModal(instanceId)) return;
      const container = modalRef.current;
      if (container && event.target instanceof Node && !container.contains(event.target)) {
        (getFocusableElements(container)[0] ?? container).focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
    };
  }, [isOpen, closeOnEscape, instanceId]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && closeOnOverlayClick) {
        onCloseRef.current();
      }
    },
    [closeOnOverlayClick]
  );

  const motionProps = prefersReducedMotion
    ? {
        initial: { opacity: 1 },
        animate: { opacity: 1 },
        exit: { opacity: 1 },
        transition: { duration: 0 },
      }
    : {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.2 },
      };

  const contentMotionProps = prefersReducedMotion
    ? {
        initial: { scale: 1, y: 0 },
        animate: { scale: 1, y: 0 },
        exit: { scale: 1, y: 0 },
        transition: { duration: 0 },
      }
    : {
        initial: { scale: 0.95, y: 20 },
        animate: { scale: 1, y: 0 },
        exit: { scale: 0.95, y: 20 },
        transition: { duration: 0.2, ease: "easeOut" },
      };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Overlay */}
          <motion.div
            {...motionProps}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
            aria-hidden="true"
          />

          {/* Positioning layer — also the click target for backdrop dismissal */}
          <div
            className={cn("fixed inset-0 z-50 flex p-4", positionClasses[position])}
            onClick={handleOverlayClick}
            data-testid="modal-backdrop"
          >
            <motion.div
              ref={modalRef}
              {...contentMotionProps}
              role={role}
              aria-modal="true"
              aria-labelledby={title ? titleId : undefined}
              aria-label={title ? undefined : ariaLabel}
              aria-describedby={ariaDescribedBy ?? (description ? descriptionId : undefined)}
              tabIndex={-1}
              className={cn(
                "bg-background border rounded-lg shadow-xl w-full focus:outline-none",
                sizeClasses[size],
                className
              )}
            >
              {/* Header */}
              {(title || showCloseButton) && (
                <div className="flex items-center justify-between p-6 border-b">
                  {title && (
                    <h2 id={titleId} className="text-lg font-semibold text-foreground">
                      {title}
                    </h2>
                  )}
                  {showCloseButton && (
                    <button
                      type="button"
                      onClick={() => onCloseRef.current()}
                      className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={title ? `Close ${title}` : "Close dialog"}
                    >
                      <X className="h-5 w-5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}

              {/* Content */}
              <div className={cn("p-6", contentClassName)}>
                {description && (
                  <div id={descriptionId} className="text-sm text-muted-foreground mb-4">
                    {description}
                  </div>
                )}
                {children}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * Modal Context for managing modal stack
 */
interface ModalStackItem {
  id: string;
  onClose: () => void;
}

export function useModalStack() {
  const [modalStack, setModalStack] = useState<ModalStackItem[]>([]);

  const addModal = useCallback((id: string, onClose: () => void) => {
    setModalStack((prev) => [...prev, { id, onClose }]);
  }, []);

  const removeModal = useCallback((id: string) => {
    setModalStack((prev) => {
      const index = prev.findIndex((item) => item.id === id);
      if (index === -1) return prev;

      // Close this modal and all modals above it
      const toClose = prev.slice(index);
      toClose.forEach((item) => item.onClose());

      return prev.slice(0, index);
    });
  }, []);

  const closeModal = useCallback(() => {
    if (modalStack.length > 0) {
      const topModal = modalStack[modalStack.length - 1];
      topModal.onClose();
      setModalStack((prev) => prev.slice(0, -1));
    }
  }, [modalStack]);

  return {
    modalStack,
    addModal,
    removeModal,
    closeModal,
  };
}
