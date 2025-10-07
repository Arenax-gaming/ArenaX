"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter, useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import Image from "next/image";

export default function JoinTournamentPage() {
  const router = useRouter();
  const params = useParams();
  const [loading, setLoading] = useState(false);
  const [teamAssigned, setTeamAssigned] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  // Example dynamic data (you’d fetch this from your API or DB)
  const tournament = {
    id: params?.id || "efb001",
    name: "ArenaX eFootball Showdown",
    game: "eFootball Mobile",
    entryFee: 0, // Change to 2000 for paid
    prizePool: "₦100,000",
    totalSlots: 64,
    slotsFilled: 53,
    banner:
      "https://assets.goal.com/images/v3/bltf1083b569da482a3/promo_en_campaign_(1).png?auto=webp&format=pjpg&width=3840&quality=60",
  };

  const europeanTeams = [
    "Manchester City",
    "Real Madrid",
    "Bayern Munich",
    "PSG",
    "Barcelona",
    "Liverpool",
    "Chelsea",
    "Arsenal",
    "Inter Milan",
    "AC Milan",
    "Napoli",
    "Juventus",
    "Atletico Madrid",
    "Dortmund",
    "Ajax",
    "RB Leipzig",
    "Tottenham",
    "Benfica",
    "Porto",
    "Sevilla",
  ];

  const nationalTeams = [
    "France",
    "Argentina",
    "Brazil",
    "England",
    "Spain",
    "Germany",
    "Portugal",
    "Netherlands",
    "Italy",
    "Belgium",
    "Croatia",
  ];

  const allTeams = [...europeanTeams, ...nationalTeams];
  const slotsLeft = tournament.totalSlots - tournament.slotsFilled;

  const assignRandomTeam = () => {
    const randomTeam = allTeams[Math.floor(Math.random() * allTeams.length)];
    setTeamAssigned(randomTeam);
    return randomTeam;
  };

  const handleJoin = () => {
    setLoading(true);
    setTimeout(() => {
      const assignedTeam = assignRandomTeam();
      setJoined(true);
      setLoading(false);
      toast.success(
        tournament.entryFee === 0
          ? `Joined successfully as ${assignedTeam}!`
          : `Payment successful! You’ve been assigned ${assignedTeam}.`
      );
    }, 2000);
  };

  const handlePayAndJoin = () => {
    toast.info("Redirecting to payment gateway...");
    setTimeout(() => {
      handleJoin();
    }, 1500);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100 py-16 px-6 flex items-center justify-center">
      <motion.div
        className="max-w-2xl w-full"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Card className="bg-[#111111]/80 border border-gray-800 backdrop-blur-xl shadow-2xl">
          <CardHeader className="space-y-2 text-center">
            <CardTitle className="text-2xl font-semibold text-white">
              {joined
                ? "Tournament Joined Successfully!"
                : "Confirm Tournament Entry"}
            </CardTitle>
            <p className="text-gray-400">
              {joined
                ? "You’ve successfully joined the tournament below."
                : "Review the details before joining."}
            </p>
          </CardHeader>

          <CardContent className="space-y-6">
            <div className="rounded-xl overflow-hidden">
              <Image
                src={tournament.banner}
                alt={tournament.name}
                className="w-full h-48 object-cover"
              />
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Tournament:</span>
                <span className="font-medium text-white">
                  {tournament.name}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Game:</span>
                <span className="font-medium text-white">
                  {tournament.game}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Prize Pool:</span>
                <span className="font-medium text-green-400">
                  {tournament.prizePool}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Slots Left:</span>
                <span className="font-medium text-blue-400">{slotsLeft}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Entry Fee:</span>
                <span
                  className={`font-medium ${
                    tournament.entryFee === 0
                      ? "text-green-400"
                      : "text-amber-400"
                  }`}
                >
                  {tournament.entryFee === 0
                    ? "Free"
                    : `₦${tournament.entryFee.toLocaleString()}`}
                </span>
              </div>
            </div>

            {!joined ? (
              <div className="pt-4">
                {tournament.entryFee === 0 ? (
                  <Button
                    onClick={handleJoin}
                    disabled={loading}
                    className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:opacity-90 transition-opacity text-white font-semibold py-6 rounded-xl"
                  >
                    {loading ? "Joining..." : "Join for Free"}
                  </Button>
                ) : (
                  <Button
                    onClick={handlePayAndJoin}
                    disabled={loading}
                    className="w-full bg-gradient-to-r from-amber-500 to-orange-600 hover:opacity-90 transition-opacity text-white font-semibold py-6 rounded-xl"
                  >
                    {loading
                      ? "Processing Payment..."
                      : `Pay ₦${tournament.entryFee} & Join`}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  className="w-full mt-3 text-gray-400 hover:text-white"
                  onClick={() => router.back()}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="mt-6 p-4 border border-gray-800 rounded-xl bg-[#1a1a1a]/80">
                <h3 className="text-lg font-semibold text-white mb-2 text-center">
                  Your Assigned Team
                </h3>
                <p className="text-center text-amber-400 text-xl font-bold">
                  {teamAssigned}
                </p>
                <p className="text-gray-400 text-sm text-center mt-2">
                  Use this team in all your tournament matches for accurate
                  tracking.
                </p>
                <Button
                  className="w-full mt-6 bg-gradient-to-r from-blue-600 to-indigo-600 hover:opacity-90 text-white font-semibold py-6 rounded-xl"
                  onClick={() => router.push("/tournaments")}
                >
                  Go Back to Tournaments
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
