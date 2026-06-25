import Link from "next/link";
import { WifiOff, RefreshCw } from "lucide-react";

export const metadata = {
  title: "Offline - ArenaX",
  description: "You are offline",
};

export default function OfflinePage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="mb-6 rounded-full bg-gray-800 p-4">
        <WifiOff className="h-12 w-12 text-gray-400" />
      </div>
      <h1 className="mb-2 text-2xl font-bold text-white">You&apos;re Offline</h1>
      <p className="mb-8 max-w-md text-gray-400">
        Don&apos;t worry! You can still browse cached content. 
        Connect to the internet to access the latest features.
      </p>
      <div className="flex gap-4">
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
        >
          <RefreshCw className="h-4 w-4" />
          Try Again
        </button>
        <Link
          href="/"
          className="inline-flex items-center rounded-lg border border-gray-700 px-6 py-3 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}
