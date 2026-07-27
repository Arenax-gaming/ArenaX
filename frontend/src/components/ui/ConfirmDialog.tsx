"use client";

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
    icon: <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />,
    iconBg: "bg-destructive/10",
    confirmClass:
      "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive",
  },
  warning: {
    icon: <AlertCircle className="h-6 w-6 text-yellow-600" aria-hidden="true" />,
    iconBg: "bg-yellow-100 dark:bg-yellow-900/30",
    confirmClass:
      "bg-yellow-600 text-white hover:bg-yellow-700 focus-visible:ring-yellow-600",
  },
  default: {
    icon: <Info className="h-6 w-6 text-primary" aria-hidden="true" />,
    iconBg: "bg-primary/10",
    confirmClass: "",
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Accessible confirmation dialog.
 *
 * - Pressing Escape or clicking the overlay cancels without confirming.
 * - The confirm button is styled destructively for the 'danger' variant.
 * - Focus is trapped inside the dialog while it is open (via Modal).
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
}: ConfirmDialogProps) {
  const { icon, iconBg, confirmClass } = VARIANT_CONFIG[variant];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      size="sm"
      closeOnOverlayClick={true}
      closeOnEscape={true}
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
          <div className="text-sm text-muted-foreground leading-relaxed pt-1.5">
            {description}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex justify-end gap-3 pt-2">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isPending}
          >
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
