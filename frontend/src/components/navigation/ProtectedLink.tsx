"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

export interface ProtectedLinkProps {
  href: string;
  children: React.ReactNode;
  className?: string;
  /** When unauthenticated, redirect to login with this return URL (default: current path) */
  redirectTo?: string;
  /** Optional fallback when unauthenticated (e.g. show a span or different link) */
  fallback?: React.ReactNode;
}

/**
 * Renders a Next.js Link for authenticated users only.
 * When the user is not logged in, redirects to login with a return URL or shows fallback.
 */
export function ProtectedLink({
  href,
  children,
  className,
  redirectTo,
  fallback,
}: ProtectedLinkProps) {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const returnUrl = redirectTo ?? pathname ?? href;
  const loginHref = `/login?redirect=${encodeURIComponent(returnUrl)}`;

  if (loading) {
    return (
      <span className={cn("opacity-60 pointer-events-none", className)}>
        {children}
      </span>
    );
  }

  if (!user) {
    if (fallback !== undefined) return <>{fallback}</>;
    return (
      <Link href={loginHref} className={className}>
        {children}
      </Link>
    );
  }

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
