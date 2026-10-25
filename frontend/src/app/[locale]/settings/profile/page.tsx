"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ProtectedPage } from "@/components/navigation/ProtectedPage";
import { ProfileSettings } from "@/components/settings/ProfileSettings";

/** Profile settings: avatar upload + granular notification preferences (#1396). */
export default function ProfileSettingsPage() {
  return (
    <ProtectedPage>
      <div className="min-h-screen bg-background">
        <div className="border-b bg-card">
          <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-4 sm:px-6 lg:px-8">
            <Link
              href="/settings"
              className="rounded-lg p-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Back to settings"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </Link>
            <div>
              <h1 className="text-xl font-bold text-foreground">Profile</h1>
              <p className="text-sm text-muted-foreground">
                Your avatar and how ArenaX notifies you
              </p>
            </div>
          </div>
        </div>

        <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
          <ProfileSettings />
        </main>
      </div>
    </ProtectedPage>
  );
}
