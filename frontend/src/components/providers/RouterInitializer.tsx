"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { setNavigate } from "@/lib/routerUtils";

/**
 * Mounts once at the top of the app tree and wires the Next.js App Router's
 * `push` function into the imperative `navigate()` helper in `routerUtils.ts`.
 *
 * This allows class components (error boundaries, etc.) to call `navigate(url)`
 * and get proper client-side routing instead of a full-page reload.
 *
 * Place this inside any client-side provider that wraps the whole app.
 */
export function RouterInitializer() {
  const router = useRouter();

  useEffect(() => {
    setNavigate((url) => router.push(url));
  }, [router]);

  return null;
}
