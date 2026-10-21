"use client";

/**
 * SettingsModal — dialog chrome for settings flows (Issues #1327, #1396).
 *
 * Builds on the accessible `Modal` (focus trap, Escape, backdrop dismissal,
 * focus restore, `role="dialog"` + `aria-modal` + `aria-labelledby`, open
 * announcement) and adds a consistent footer for primary / secondary actions.
 */

import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** Action buttons rendered in the footer. */
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Disable backdrop / Escape dismissal (e.g. while saving). */
  dismissible?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement>;
  className?: string;
}

export function SettingsModal({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
  initialFocusRef,
  className,
}: SettingsModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      description={description}
      size={size}
      closeOnOverlayClick={dismissible}
      closeOnEscape={dismissible}
      showCloseButton={dismissible}
      initialFocusRef={initialFocusRef}
      className={className}
    >
      <div className="space-y-6">
        {children}
        {footer && (
          <div className={cn("flex flex-wrap justify-end gap-3 border-t pt-4")}>{footer}</div>
        )}
      </div>
    </Modal>
  );
}

export default SettingsModal;
