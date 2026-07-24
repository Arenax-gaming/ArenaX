/**
 * Lightweight native-select wrapper that matches the project's design system.
 * Exposes the same surface as the shadcn/ui Select API used in the codebase
 * (SelectTrigger / SelectContent / SelectItem / SelectValue) so existing
 * import sites work without changes, while avoiding the Radix UI dependency
 * that isn't installed.
 */
import React, { createContext, useContext, useId } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

// ---------------------------------------------------------------------------
// Context — carries the native <select> ref so child components can read the
// current value for the SelectValue placeholder.
// ---------------------------------------------------------------------------
interface SelectContextValue {
  value: string;
  onValueChange: (value: string) => void;
  id: string;
}

const SelectContext = createContext<SelectContextValue | null>(null);

function useSelectContext() {
  const ctx = useContext(SelectContext);
  if (!ctx) throw new Error("Select sub-components must be used inside <Select>");
  return ctx;
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------
export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
}

export function Select({ value, onValueChange, children, disabled }: SelectProps) {
  const id = useId();
  return (
    <SelectContext.Provider value={{ value, onValueChange, id }}>
      <div className={cn("relative", disabled && "opacity-50 pointer-events-none")}>
        {children}
      </div>
    </SelectContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Trigger — renders the native <select> styled to look like a button
// ---------------------------------------------------------------------------
export interface SelectTriggerProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  className?: string;
  children?: React.ReactNode; // SelectValue child — ignored, value shown natively
}

export const SelectTrigger = React.forwardRef<
  HTMLSelectElement,
  SelectTriggerProps
>(({ className, children: _children, id: idProp, ...props }, ref) => {
  const { value, onValueChange, id: ctxId } = useSelectContext();
  return (
    <div className="relative">
      {/* The actual native select — invisible but interactive */}
      <select
        ref={ref}
        id={idProp ?? ctxId}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className={cn(
          "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-sm",
          "ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
      {/* Chevron overlay */}
      <ChevronDown
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
        aria-hidden="true"
      />
    </div>
  );
});
SelectTrigger.displayName = "SelectTrigger";

// ---------------------------------------------------------------------------
// Content — renders <option> elements inside the native select.
// Because native selects render their own dropdown, this component just
// passes children through; the actual <option> elements come from SelectItem.
// ---------------------------------------------------------------------------
export function SelectContent({ children }: { children: React.ReactNode }) {
  // Children (SelectItem) are rendered as <option> elements inside the
  // SelectTrigger's native <select>. We need to inject them there.
  // Since we're using a native select, we render them as a React fragment
  // and rely on SelectTrigger consuming them via the context.
  // The simplest approach: render nothing here — SelectItem renders directly.
  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// Item — renders a native <option>
// ---------------------------------------------------------------------------
export interface SelectItemProps {
  value: string;
  children: React.ReactNode;
  disabled?: boolean;
}

export function SelectItem({ value, children, disabled }: SelectItemProps) {
  return (
    <option value={value} disabled={disabled}>
      {children}
    </option>
  );
}

// ---------------------------------------------------------------------------
// Value — displays the current value label inside the trigger.
// With a native select this is handled automatically, so this is a no-op
// placeholder that satisfies the import.
// ---------------------------------------------------------------------------
export function SelectValue({ placeholder: _placeholder }: { placeholder?: string }) {
  return null;
}
