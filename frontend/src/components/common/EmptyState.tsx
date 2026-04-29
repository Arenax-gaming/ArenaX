import React from "react";
import { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  iconClassName?: string;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    variant?: "primary" | "secondary" | "outline" | "ghost" | "destructive";
  };
  className?: string;
  size?: "sm" | "md" | "lg";
}

export function EmptyState({
  icon: Icon,
  iconClassName,
  title,
  description,
  action,
  className,
  size = "md",
}: EmptyStateProps) {
  const sizeStyles = {
    sm: {
      icon: "h-8 w-8",
      title: "text-base",
      description: "text-sm",
    },
    md: {
      icon: "h-12 w-12",
      title: "text-lg",
      description: "text-sm",
    },
    lg: {
      icon: "h-16 w-16",
      title: "text-xl",
      description: "text-base",
    },
  };

  const currentSize = sizeStyles[size];

  return (
    <div className={cn("flex flex-col items-center justify-center py-12 px-4", className)}>
      {Icon && (
        <Icon
          className={cn(
            "text-muted-foreground mb-4",
            currentSize.icon,
            iconClassName
          )}
        />
      )}
      <h3 className={cn("font-semibold text-foreground mb-2", currentSize.title)}>
        {title}
      </h3>
      {description && (
        <p className={cn("text-muted-foreground mb-4 text-center max-w-md", currentSize.description)}>
          {description}
        </p>
      )}
      {action && (
        <Button
          onClick={action.onClick}
          variant={action.variant || "primary"}
          size="sm"
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
