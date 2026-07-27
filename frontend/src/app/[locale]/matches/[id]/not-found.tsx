import Link from "next/link";

/**
 * Rendered by Next.js when notFound() is called from the match hub page.
 */
export default function MatchNotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center bg-background px-4">
      <div className="text-center space-y-4">
        <p className="text-6xl font-black text-muted-foreground/30">404</p>
        <h1 className="text-2xl font-bold text-foreground">Match Not Found</h1>
        <p className="text-muted-foreground max-w-sm mx-auto">
          This match doesn&apos;t exist or may have been removed.
        </p>
        <Link
          href="/tournaments"
          className="inline-flex items-center justify-center rounded-md font-medium transition-colors h-10 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Back to Tournaments
        </Link>
      </div>
    </div>
  );
}
