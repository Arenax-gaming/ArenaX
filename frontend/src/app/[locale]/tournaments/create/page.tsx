"use client";

import { ProtectedPage } from "@/components/navigation/ProtectedPage";
import { TournamentCreationWizard } from "@/components/tournaments/TournamentCreationWizard";

export default function CreateTournamentPage() {
  return (
    <ProtectedPage>
      <div className="min-h-screen bg-background px-4 py-8">
        <TournamentCreationWizard />
      </div>
    </ProtectedPage>
  );
}
