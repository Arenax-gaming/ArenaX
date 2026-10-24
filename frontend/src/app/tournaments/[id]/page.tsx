"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useParams, useRouter } from "next/navigation";
import { useTournamentLive } from "@/hooks/useTournamentLive";
import { matchResultText } from "@/lib/tournament-stream";
import Image from "next/image";
// import { Progress } from "@/components/ui/progress"; // optional shadcn/ui progress bar

const fallbackBanner =
  "https://assets.goal.com/images/v3/bltf1083b569da482a3/promo_en_campaign_(1).png?auto=webp&format=pjpg&width=3840&quality=60";

function bannerUrl(value: string | undefined) {
  if (value?.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value || fallbackBanner);
    if (url.protocol === "https:" && ["codmwstore.com", "assets-prd.ignimgs.com", "assets.goal.com"].includes(url.hostname)) return url.href;
  } catch {
    // The existing image allowlist determines which remote banners can render.
  }
  return fallbackBanner;
}

function money(amount: string | number, currency: string | null | undefined) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return String(amount);
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: currency || "NGN" }).format(value);
  } catch {
    return String(amount) + " " + (currency || "NGN");
  }
}

export default function TournamentDetailsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { tournament, connection, latestResult, error, loading, retry } = useTournamentLive(params.id);

  if (!tournament) {
    return (
      <main className="min-h-screen bg-black text-white pt-24 px-6">
        {loading ? <p role="status">Loading tournament...</p> : (
          <div>
            <p role="alert">{error || "Tournament not found."}</p>
            <Button onClick={retry} className="mt-4">Try again</Button>
          </div>
        )}
      </main>
    );
  }

  const normalizedStatus = tournament.status.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  const tournamentData = {
    id: tournament.id,
    name: tournament.name,
    game: tournament.game_type || tournament.game || "",
    banner: bannerUrl(tournament.metadata?.banner_url),
    prizePool: money(tournament.prize_pool, tournament.prize_pool_currency),
    entryFee: money(tournament.entry_fee, tournament.entry_fee_currency),
    startDate: new Date(tournament.start_time).toLocaleDateString(),
    status: normalizedStatus.replace(/_/g, " "),
    totalSlots: tournament.max_participants,
    currentParticipants: tournament.current_participants,
    description: tournament.description || "",
    rules: tournament.rules || [],
  };
  const canJoin = normalizedStatus === "registration_open" || normalizedStatus === "upcoming";
  const resultText = latestResult ? matchResultText(latestResult) : null;

  const slotsLeft =
    Math.max(0, tournamentData.totalSlots - tournamentData.currentParticipants);
  const slotPercentage =
    Math.min(100, (tournamentData.currentParticipants / Math.max(1, tournamentData.totalSlots)) * 100);

  const handleJoin = () => {
    router.push(`/tournaments/${tournamentData.id}/join`);
  };

  return (
    <main className="min-h-screen bg-black text-white pt-16">
      {/* Banner Section */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative w-full h-64 md:h-80 lg:h-96"
      >
        <Image
          src={tournamentData.banner}
          alt={tournamentData.name}
          fill
          className="object-cover brightness-75"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />
        <div className="absolute bottom-6 left-6">
          <h1 className="text-3xl md:text-4xl font-bold text-green-500 drop-shadow-lg">
            {tournamentData.name}
          </h1>
          <p className="text-gray-300">{tournamentData.game}</p>
        </div>
      </motion.div>

      <p role="status" aria-live="polite" className="container mx-auto px-4 pt-6 text-sm text-gray-300">
        {connection === "live" ? "Live tournament updates" : connection === "reconnecting" ? "Reconnecting to live updates..." : "Connecting to live updates..."}
      </p>
      {error && <p role="alert" className="container mx-auto px-4 pt-2 text-amber-300">{error}</p>}

      {/* Details Section */}
      <section className="container mx-auto px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-zinc-900/60 backdrop-blur-xl rounded-2xl border border-green-500/20 p-6 shadow-lg"
        >
          <div className="flex flex-col md:flex-row justify-between gap-6">
            <div>
              <h2 className="text-2xl font-bold mb-2">{tournamentData.name}</h2>
              <Badge
                className={
                  normalizedStatus === "in_progress"
                    ? "bg-green-500/20 text-green-400"
                    : normalizedStatus === "upcoming"
                    ? "bg-blue-500/20 text-blue-400"
                    : "bg-gray-600/20 text-gray-400"
                }
              >
                {tournamentData.status}
              </Badge>

              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm text-gray-300">
                <div>
                  <p className="font-semibold text-white">Prize Pool</p>
                  <p>{tournamentData.prizePool}</p>
                </div>
                <div>
                  <p className="font-semibold text-white">Entry Fee</p>
                  <p>{tournamentData.entryFee}</p>
                </div>
                <div>
                  <p className="font-semibold text-white">Start Date</p>
                  <p>{tournamentData.startDate}</p>
                </div>
                <div>
                  <p className="font-semibold text-white">Total Slots</p>
                  <p>{tournamentData.totalSlots}</p>
                </div>
                <div>
                  <p className="font-semibold text-white">Participants</p>
                  <p>{tournamentData.currentParticipants}</p>
                </div>
                <div>
                  <p className="font-semibold text-white">Slots Left</p>
                  <p
                    className={
                      slotsLeft <= 10 ? "text-red-400" : "text-green-400"
                    }
                  >
                    {slotsLeft} remaining
                  </p>
                </div>
              </div>

              {/* Slots Progress Bar */}
              <div className="mt-4">
                <p className="text-sm text-gray-400 mb-1">
                  Registration Progress
                </p>
                <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${slotPercentage}%` }}
                    transition={{ duration: 1 }}
                    className="h-2 bg-green-500 rounded-full"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-center">
              {canJoin ? (
                <Button
                  onClick={handleJoin}
                  className="bg-green-500 hover:bg-green-600 text-black font-semibold px-6 py-2"
                >
                  Join Now
                </Button>
              ) : (
                <Button
                  disabled
                  className="bg-zinc-800 hover:bg-zinc-700 text-green-400 border border-green-500/30"
                >
                  Registration closed
                </Button>
              )}
            </div>
          </div>

          {resultText && (
            <section className="mt-6 rounded-xl border border-green-500/20 p-4" aria-live="polite">
              <h3 className="font-semibold text-green-400">Latest match result</h3>
              <p className="mt-2 text-gray-300">{resultText}</p>
            </section>
          )}

          {/* Description */}
          <div className="mt-8">
            <h3 className="text-lg font-semibold text-green-400 mb-2">About</h3>
            <p className="text-gray-300 leading-relaxed">
              {tournamentData.description}
            </p>
          </div>

          {/* Rules */}
          <div className="mt-6">
            <h3 className="text-lg font-semibold text-green-400 mb-2">Rules</h3>
            <ul className="list-disc list-inside text-gray-300 space-y-1">
              {tournamentData.rules.map((rule, i) => (
                <li key={i}>{rule}</li>
              ))}
            </ul>
          </div>
        </motion.div>
      </section>
    </main>
  );
}
