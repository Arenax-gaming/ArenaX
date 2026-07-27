"use client";

/**
 * RouteGuard — universal client-side route protection component.
 *
 * Reads the route requirement from ROUTE_CONFIGS and enforces:
 *   - Authentication check  → redirect to /login
 *   - Email verification    → redirect to /verify-email
 *   - Role check (admin)    → render inline 403 or redirect to /admin/access-denied
 *
 * Also fires route-guard analytics events so we can monitor access patterns.
 *
 * Usage:
 *   Wrap any page that needs protection. For admin pages the Edge middleware
 *   already handles server-side enforcement; this component is the client-side
 *   defence-in-depth layer.
 *
 *   <RouteGuard requirement="verified">
 *     <DashboardContent />
 *   </RouteGuard>
 */

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { trackGuardEvent } from "@/lib/routeAnalytics";
import type { RouteRequirement } from "@/lib/routeConfig";

export interface RouteGuardProps {
  children: React.ReactNode;
  /**
   * The access level this route requires.
   * Defaults to "auth" (must be logged in).
   */
  requirement?: RouteRequirement;
  /**
   * Custom redirect path on auth failure.
   * Defaults to `/[locale]/login?redirect=<current-path>`.
   */
  loginRedirect?: string;
  /**
   * Show a loading skeleton while auth state resolves.
   * Defaults to a minimal spinner.
   */
  loadingFallback?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function DefaultLoadingSkeleton() {
  return (
    <div
      className="flex items-center justify-center min-h-[60vh]"
      role="status"
      aria-label="Loading page"
    >
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <span className="text-sm text-muted-foreground">Loading…</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Forbidden (403) UI
// ---------------------------------------------------------------------------

function ForbiddenView({ requiredRole }: { requiredRole: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-100 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
          <span
            className="w-2 h-2 rounded-full bg-red-500 shrink-0"
            aria-hidden="true"
          />
          <span className="text-xs font-bold uppercase tracking-widest text-red-700 dark:text-red-400">
            403 Forbidden
          </span>
        </div>

        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-full bg-red-50 dark:bg-red-950/20 border-2 border-red-200 dark:border-red-800 flex items-center justify-center">
            <svg
              className="w-10 h-10 text-red-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              />
            </svg>
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100">
            Access Denied
          </h1>
          <p className="text-muted-foreground">
            You don&apos;t have the required{" "}
            <strong>{requiredRole}</strong> role to view this page.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md font-medium transition-colors h-10 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Go to Home
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-md font-medium transition-colors h-10 px-4 py-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Sign in with a different account
          </Link>
        </div>

        <p className="text-xs text-muted-foreground pt-2">
          If you believe this is a mistake, contact your platform administrator.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Verification required UI
// ---------------------------------------------------------------------------

function VerificationRequiredView() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-yellow-100 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800">
          <span
            className="w-2 h-2 rounded-full bg-yellow-500 shrink-0"
            aria-hidden="true"
          />
          <span className="text-xs font-bold uppercase tracking-widest text-yellow-700 dark:text-yellow-400">
            Email Not Verified
          </span>
        </div>

        <div className="space-y-2">
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100">
            Verify Your Email
          </h1>
          <p className="text-muted-foreground">
            You need to verify your email address before accessing this area.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Link
            href="/verify-email"
            className="inline-flex items-center justify-center rounded-md font-medium transition-colors h-10 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Go to Verification
          </Link>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md font-medium transition-colors h-10 px-4 py-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guard component
// ---------------------------------------------------------------------------

export function RouteGuard({
  children,
  requirement = "auth",
  loginRedirect,
  loadingFallback,
}: RouteGuardProps) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  // Track whether we already fired an analytics event for this render cycle
  const trackedRef = useRef(false);

  // Build the login URL with a redirect-back parameter
  const loginUrl =
    loginRedirect ??
    `/${locale}/login?redirect=${encodeURIComponent(pathname)}`;

  const verifyUrl = `/${locale}/verify-email`;

  useEffect(() => {
    if (loading || trackedRef.current) return;

    if (requirement === "public") return;

    if (!user) {
      trackedRef.current = true;
      trackGuardEvent({
        type: "auth_redirect",
        path: pathname,
        locale,
      });
      router.replace(loginUrl);
      return;
    }

    if (requirement === "verified" && !user.isVerified) {
      trackedRef.current = true;
      trackGuardEvent({
        type: "verification_required",
        path: pathname,
        locale,
      });
      // Show inline verification prompt rather than redirect
      return;
    }

    if (requirement === "admin" && user.role !== "admin") {
      trackedRef.current = true;
      trackGuardEvent({
        type: "role_denied",
        path: pathname,
        locale,
        requiredRole: "admin",
      });
      return;
    }

    if (requirement === "moderator" && user.role !== "admin" && user.role !== "moderator") {
      trackedRef.current = true;
      trackGuardEvent({
        type: "role_denied",
        path: pathname,
        locale,
        requiredRole: "moderator",
      });
    }
  }, [loading, user, requirement, router, loginUrl, verifyUrl, pathname, locale]);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return <>{loadingFallback ?? <DefaultLoadingSkeleton />}</>;
  }

  // ── Public ───────────────────────────────────────────────────────────────
  if (requirement === "public") {
    return <>{children}</>;
  }

  // ── Unauthenticated ───────────────────────────────────────────────────────
  if (!user) {
    // Render nothing while redirect fires
    return null;
  }

  // ── Verification required ─────────────────────────────────────────────────
  if (requirement === "verified" && !user.isVerified) {
    return <VerificationRequiredView />;
  }

  // ── Role check ────────────────────────────────────────────────────────────
  if (requirement === "admin" && user.role !== "admin") {
    return <ForbiddenView requiredRole="admin" />;
  }

  if (
    requirement === "moderator" &&
    user.role !== "admin" &&
    user.role !== "moderator"
  ) {
    return <ForbiddenView requiredRole="moderator" />;
  }

  return <>{children}</>;
}
