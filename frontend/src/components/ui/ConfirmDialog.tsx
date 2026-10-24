"use client";

import { useId, useRef } from "react";
import { AlertTriangle, AlertCircle, Info } from "lucide-react";
import { Modal } from "./Modal";
import { Button } from "./Button";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConfirmDialogVariant = "danger" | "warning" | "default";

export interface ConfirmDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  /** Summary shown inside the dialog body */
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmDialogVariant;
  /** Disable the confirm button while an async action is in flight */
  isPending?: boolean;
  /** Close when the backdrop is clicked (default true). */
  closeOnOverlayClick?: boolean;
}

// ─── Variant config ───────────────────────────────────────────────────────────

const VARIANT_CONFIG: Record<
  ConfirmDialogVariant,
  {
    icon: React.ReactNode;
    iconBg: string;
    confirmClass: string;
  }
> = {
  danger: {
    icon: <AlertTriangle className="h-6 w-6 text-destructive-text" aria-hidden="true" />,
    iconBg: "bg-destructive/10",
    confirmClass:
      "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive",
  },
  warning: {
    icon: <AlertCircle className="h-6 w-6 text-rank" aria-hidden="true" />,
    iconBg: "bg-warning-muted",
    confirmClass:
      "bg-warning-muted-foreground text-background hover:opacity-90 focus-visible:ring-warning",
  },
  default: {
    icon: <Info className="h-6 w-6 text-primary" aria-hidden="true" />,
    iconBg: "bg-primary/10",
    confirmClass: "",
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Accessible confirmation dialog (Issue #1327).
 *
 * - Rendered as `role="alertdialog"`, labelled by the title and described by
 *   the description, and announced when it opens.
 * - Initial focus lands on Cancel, so an accidental Enter never confirms a
 *   destructive action.
 * - Escape or a backdrop click cancels without confirming; focus returns to
 *   the element that opened it, and Tab is trapped inside (via Modal).
 */
export function ConfirmDialog({
  isOpen,
  onConfirm,
  onCancel,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  isPending = false,
  closeOnOverlayClick = true,
}: ConfirmDialogProps) {
  const { icon, iconBg, confirmClass } = VARIANT_CONFIG[variant];
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      size="sm"
      role="alertdialog"
      ariaDescribedBy={descriptionId}
      initialFocusRef={cancelRef}
      announcement={`${title}. Confirmation required.`}
      closeOnOverlayClick={closeOnOverlayClick && !isPending}
      closeOnEscape={!isPending}
      showCloseButton={false}
    >
      <div className="space-y-4">
        {/* Icon + description */}
        <div className="flex gap-4 items-start">
          <div
            className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${iconBg}`}
          >
            {icon}
          </div>
          <div
            id={descriptionId}
            className="text-sm text-muted-foreground leading-relaxed pt-1.5"
          >
            {description}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex justify-end gap-3 pt-2">
          <Button ref={cancelRef} variant="outline" onClick={onCancel} disabled={isPending}>
            {cancelLabel}
          </Button>
          <Button
            className={confirmClass || undefined}
            onClick={onConfirm}
            disabled={isPending}
            aria-busy={isPending}
          >
            {isPending ? "Processing…" : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
