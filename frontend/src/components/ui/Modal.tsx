"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/hooks/useReducedMotion";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  position?: "center" | "top" | "bottom";
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  showCloseButton?: boolean;
  className?: string;
  contentClassName?: string;
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

/**
 * Advanced Modal Component with:
 * - Focus management (trap focus within modal)
 * - Accessibility (ARIA attributes, keyboard navigation)
 * - Modal stacking (supports nested modals)
 * - Animation support with reduced motion preference
 * - Escape key and overlay click to close
 */
export function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = "md",
  position = "center",
  closeOnOverlayClick = true,
  closeOnEscape = true,
  showCloseButton = true,
  className,
  contentClassName,
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const prefersReducedMotion = useReducedMotion();

  // Store previously focused element when modal opens
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
    }
  }, [isOpen]);

  // Focus management: trap focus within modal
  useEffect(() => {
    if (!isOpen || !modalRef.current) return;

    const modal = modalRef.current;
    const focusableElements = modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstFocusable = focusableElements[0] as HTMLElement;
    const lastFocusable = focusableElements[focusableElements.length - 1] as HTMLElement;

    // Focus first element when modal opens
    if (firstFocusable) {
      firstFocusable.focus();
    }

    // Trap focus within modal
    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      if (e.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstFocusable) {
          e.preventDefault();
          lastFocusable?.focus();
        }
      } else {
        // Tab
        if (document.activeElement === lastFocusable) {
          e.preventDefault();
          firstFocusable?.focus();
        }
      }
    };

    document.addEventListener("keydown", handleTab);

    return () => {
      document.removeEventListener("keydown", handleTab);
      // Restore focus when modal closes
      previousActiveElement.current?.focus();
    };
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, closeOnEscape, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && closeOnOverlayClick) {
        onClose();
      }
    },
    [onClose, closeOnOverlayClick]
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
            onClick={handleOverlayClick}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
            aria-hidden="true"
          />

          {/* Modal */}
          <div
            className={cn(
              "fixed inset-0 z-50 flex p-4 pointer-events-none",
              positionClasses[position]
            )}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? "modal-title" : undefined}
          >
            <motion.div
              ref={modalRef}
              {...contentMotionProps}
              className={cn(
                "bg-background border rounded-lg shadow-xl pointer-events-auto w-full",
                sizeClasses[size],
                className
              )}
            >
              {/* Header */}
              {(title || showCloseButton) && (
                <div className="flex items-center justify-between p-6 border-b">
                  {title && (
                    <h2
                      id="modal-title"
                      className="text-lg font-semibold text-foreground"
                    >
                      {title}
                    </h2>
                  )}
                  {showCloseButton && (
                    <button
                      onClick={onClose}
                      className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted"
                      aria-label="Close modal"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  )}
                </div>
              )}

              {/* Content */}
              <div className={cn("p-6", contentClassName)}>{children}</div>
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
