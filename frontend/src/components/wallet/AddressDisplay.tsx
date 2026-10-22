"use client";

import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/common/CopyButton";

interface AddressDisplayProps {
  /** Full Stellar address (or any long identifier). */
  address: string | null | undefined;
  /** Characters kept at each end when truncated. */
  visibleChars?: number;
  /** Noun used for the copy button's aria-label and toast. */
  label?: string;
  className?: string;
}

export const truncateAddress = (value: string, visibleChars = 6) => {
  if (value.length <= visibleChars * 2 + 3) return value;
  return `${value.slice(0, visibleChars)}...${value.slice(-visibleChars)}`;
};

/**
 * Truncated address with a copy button that always copies the full value
 * (Issue #1336).
 */
export function AddressDisplay({
  address,
  visibleChars = 6,
  label = "wallet address",
  className,
}: AddressDisplayProps) {
  if (!address) {
    return <span className={cn("font-medium", className)}>-</span>;
  }

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span className="font-medium font-mono" title={address}>
        {truncateAddress(address, visibleChars)}
      </span>
      <CopyButton
        value={address}
        label={label}
        successMessage={`${label.charAt(0).toUpperCase()}${label.slice(1)} copied`}
      />
    </span>
  );
}
