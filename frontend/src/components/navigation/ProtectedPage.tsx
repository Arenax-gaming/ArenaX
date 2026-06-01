"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";

export interface ProtectedPageProps {
  children: React.ReactNode;
  requiredRole?: "admin" | "moderator";
}

/**
 * Client-side guard — a second layer on top of the Edge middleware.
 *
 * The middleware handles unauthenticated and non-admin users before the page
 * even renders. This component covers the case where the client-side auth
 * state diverges from the cookie (e.g. token stored only in sessionStorage
 * and the middleware cookie is absent), and provides a visible 403 UI rather
 * than a silent blank screen.
 */
export function ProtectedPage({ children, requiredRole }: ProtectedPageProps) {
  const router = useRouter();
  const { user, loading } = useAuth();

  // Redirect unauthenticated users to login
  useEffect(() => {
    if (!loading && !user) {
      router.replace(
        `/login?redirect=${encodeURIComponent(window.location.pathname)}`
      );
    }
  }, [user, loading, router]);

  // Loading skeleton
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-muted-foreground">Loading…</div>
      </div>
    );
  }

  // Not authenticated — render nothing while the redirect fires
  if (!user) {
    return null;
  }

  // Authenticated but wrong role — show inline 403 instead of silent redirect
  if (requiredRole && user.role !== requiredRole) {
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
              You don&apos;t have permission to view this page.{" "}
              {requiredRole === "admin" ? "Admin" : "Moderator"} access is
              required.
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
            If you believe this is a mistake, contact your platform
            administrator.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
