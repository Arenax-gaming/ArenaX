export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <span className="text-6xl" aria-hidden="true">⚡</span>
      <h1 className="text-2xl font-bold">You&apos;re offline</h1>
      <p className="max-w-sm text-gray-500">
        No internet connection detected. Check your network and try again.
        Changes you make will sync automatically when you reconnect.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="mt-2 rounded-lg bg-blue-600 px-5 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        Try again
      </button>
    </main>
  );
}
