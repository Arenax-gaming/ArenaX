"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";
import Image from "next/image";
// import { Progress } from "@/components/ui/progress"; // optional shadcn/ui progress bar

const tournamentData = {
  id: "1",
  name: "ArenaX eFootball Masters Cup",
  game: "eFootball Mobile",
  banner:
    "https://assets.goal.com/images/v3/bltf1083b569da482a3/promo_en_campaign_(1).png?auto=webp&format=pjpg&width=3840&quality=60",
  prizePool: "₦200,000",
  entryFee: "₦2,000",
  startDate: "Oct 10, 2025",
  status: "Ongoing",
  totalSlots: 128,
  currentParticipants: 94,
  description: `
    Compete with the best eFootball Mobile players in the ArenaX Masters Cup! 
    Showcase your dribbling, passing, and finishing to climb the leaderboard. 
    Prizes are awarded to the top 3 players, and every match counts!
  `,
  rules: [
    "Only eFootball Mobile players are eligible.",
    "No emulators or cheats allowed.",
    "Matches are knockout-style (1v1).",
    "Winners advance automatically via ArenaX system.",
  ],
};

export default function TournamentDetailsPage() {
  const router = useRouter();

  const slotsLeft =
    tournamentData.totalSlots - tournamentData.currentParticipants;
  const slotPercentage =
    (tournamentData.currentParticipants / tournamentData.totalSlots) * 100;

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
                  tournamentData.status === "Ongoing"
                    ? "bg-green-500/20 text-green-400"
                    : tournamentData.status === "Upcoming"
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
              {tournamentData.status === "Ongoing" ||
              tournamentData.status === "Upcoming" ? (
                <Button
                  onClick={handleJoin}
                  className="bg-green-500 hover:bg-green-600 text-black font-semibold px-6 py-2"
                >
                  Join Now
                </Button>
              ) : (
                <Button
                  onClick={() =>
                    router.push(`/tournaments/${tournamentData.id}/results`)
                  }
                  className="bg-zinc-800 hover:bg-zinc-700 text-green-400 border border-green-500/30"
                >
                  View Results
                </Button>
              )}
            </div>
          </div>

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
