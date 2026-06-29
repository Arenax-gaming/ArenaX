/**
 * /admin/access-denied
 *
 * Shown by the middleware when an authenticated user without the "admin" role
 * attempts to access any /admin/* route.
 *
 * This is a Server Component — no "use client" directive — so it renders
 * before any client-side JavaScript runs, giving a true server-side 403.
 */
import Link from "next/link";

export const metadata = {
  title: "Access Denied — ArenaX Admin",
};

export default function AccessDeniedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center space-y-6">
        {/* Status badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-100 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" aria-hidden="true" />
          <span className="text-xs font-bold uppercase tracking-widest text-red-700 dark:text-red-400">
            403 Forbidden
          </span>
        </div>

        {/* Icon */}
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
                d="M12 15v2m0 0v2m0-2h2m-2 0H10m2-6V7m0 0a5 5 0 100 10A5 5 0 0012 7z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M18.364 5.636A9 9 0 115.636 18.364 9 9 0 0118.364 5.636z"
              />
            </svg>
          </div>
        </div>

        {/* Heading */}
        <div className="space-y-2">
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100">
            Access Denied
          </h1>
          <p className="text-muted-foreground">
            You don&apos;t have permission to view this page. Admin access is
            required.
          </p>
        </div>

        {/* Actions */}
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

        {/* Footer note */}
        <p className="text-xs text-muted-foreground pt-2">
          If you believe this is a mistake, contact your platform administrator.
        </p>
      </div>
    </div>
  );
}
