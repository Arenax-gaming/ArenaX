import React from "react";
import { AlertTriangle, LucideIcon, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  /** Localised heading (pass a string from `useTranslations`) */
  title: string;
  /** Localised detail text */
  description?: string;
  /** Localised retry button label */
  retryLabel: string;
  /** Re-triggers the failed fetch */
  onRetry: () => void;
  icon?: LucideIcon;
  className?: string;
}

export function ErrorState({
  title,
  description,
  retryLabel,
  onRetry,
  icon: Icon = AlertTriangle,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center py-12 px-4", className)}
      role="alert"
    >
      <Icon className="mb-4 h-12 w-12 text-destructive" aria-hidden="true" />
      <h3 className="mb-2 text-lg font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="mb-4 max-w-md text-center text-sm text-muted-foreground">{description}</p>
      )}
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
        {retryLabel}
      </Button>
    </div>
  );
}
