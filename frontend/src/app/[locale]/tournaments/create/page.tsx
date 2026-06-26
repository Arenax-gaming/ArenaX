"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Trophy } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/hooks/useAuth";
import { ProtectedPage } from "@/components/navigation/ProtectedPage";

export default function CreateTournamentPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [maxParticipants, setMaxParticipants] = useState(16);
  const [entryFee, setEntryFee] = useState(0);
  const [prizePool, setPrizePool] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Tournament name is required.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      // Placeholder — replace with api.createTournament(...)
      await new Promise((r) => setTimeout(r, 500));
      router.push("/tournaments");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create tournament.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ProtectedPage>
      <div className="min-h-screen bg-background px-4 py-8">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Back link */}
          <Link
            href="/tournaments"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to tournaments
          </Link>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-2xl">
                <Trophy className="h-6 w-6 text-yellow-500" />
                Create Tournament
              </CardTitle>
              <CardDescription>
                Set up your tournament details below. You can edit these after
                creation until registration opens.
              </CardDescription>
            </CardHeader>

            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Name */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="tournament-name"
                    className="text-sm font-medium"
                  >
                    Tournament name <span className="text-destructive">*</span>
                  </label>
                  <Input
                    id="tournament-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Weekly Ranked Cup"
                    required
                  />
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="tournament-description"
                    className="text-sm font-medium"
                  >
                    Description
                  </label>
                  <textarea
                    id="tournament-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    placeholder="Brief description of rules and format…"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                  />
                </div>

                {/* Number grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="max-participants"
                      className="text-sm font-medium"
                    >
                      Max participants
                    </label>
                    <Input
                      id="max-participants"
                      type="number"
                      min={2}
                      max={256}
                      value={maxParticipants}
                      onChange={(e) =>
                        setMaxParticipants(Number(e.target.value))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="entry-fee"
                      className="text-sm font-medium"
                    >
                      Entry fee ($)
                    </label>
                    <Input
                      id="entry-fee"
                      type="number"
                      min={0}
                      step={0.01}
                      value={entryFee}
                      onChange={(e) => setEntryFee(Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="prize-pool"
                      className="text-sm font-medium"
                    >
                      Prize pool ($)
                    </label>
                    <Input
                      id="prize-pool"
                      type="number"
                      min={0}
                      step={0.01}
                      value={prizePool}
                      onChange={(e) => setPrizePool(Number(e.target.value))}
                    />
                  </div>
                </div>

                {/* Error */}
                {error && (
                  <p className="text-sm text-destructive" role="alert">
                    {error}
                  </p>
                )}

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <Button
                    type="submit"
                    loading={isSubmitting}
                    disabled={isSubmitting}
                    className="flex-1"
                  >
                    Create tournament
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => router.back()}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </ProtectedPage>
  );
}
