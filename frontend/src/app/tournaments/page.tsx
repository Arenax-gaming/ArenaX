"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

export default function TournamentsPage() {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedGame, setSelectedGame] = useState("all");
  const router = useRouter();

  const tournaments = [
    {
      id: 1,
      name: "ArenaX Clash Cup",
      game: "C.O.D Warzone",
      prizePool: "$2,000",
      fee: "$10",
      startDate: "Oct 15, 2025",
      status: "ongoing",
      banner:
        "https://codmwstore.com/wp-content/uploads/2024/03/WZM-GLOBALRELEASE-TOUT.jpg",
    },
    {
      id: 2,
      name: "Battle Royale Showdown",
      game: "PUBG",
      prizePool: "$1,500",
      fee: "Free",
      startDate: "Oct 20, 2025",
      status: "upcoming",
      banner:
        "https://assets-prd.ignimgs.com/2023/05/18/mortalkombat1-1684430065700.jpg?crop=1%3A1%2Csmart&format=jpg&auto=webp&quality=80",
    },
    {
      id: 3,
      name: "Legends Arena",
      game: "E Football",
      prizePool: "$3,000",
      fee: "$15",
      startDate: "Sep 25, 2025",
      status: "completed",
      banner:
        "https://assets.goal.com/images/v3/bltf1083b569da482a3/promo_en_campaign_(1).png?auto=webp&format=pjpg&width=3840&quality=60",
    },
  ];

  const filteredTournaments = tournaments.filter((t) => {
    const matchFilter = filter === "all" || t.status === filter;
    const matchSearch = t.name.toLowerCase().includes(search.toLowerCase());
    const matchGame = selectedGame === "all" || t.game === selectedGame;
    return matchFilter && matchSearch && matchGame;
  });

  const handleClick = (id: string) => {
    router.push(`/tournaments/${id}`);
  };
  const statusColors = {
    ongoing: "bg-green-500/20 text-green-400 border-green-500/30",
    upcoming: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    completed: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  };

  return (
    <main className="min-h-screen bg-black text-white py-10 px-4 md:px-10">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-6xl mx-auto text-center mb-10"
      >
        <h1 className="text-3xl md:text-5xl font-bold text-green-500 drop-shadow-[0_0_15px_rgba(34,197,94,0.4)]">
          ArenaX Tournaments
        </h1>
        <p className="text-gray-400 mt-2">
          Join exciting competitions and climb the leaderboard!
        </p>
      </motion.div>

      {/* Filters */}
      <div className="max-w-6xl mx-auto mb-8 flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Search */}
        <div className="flex w-full md:w-1/3">
          <Input
            placeholder="Search tournaments..."
            className="bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-400"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Game Dropdown */}
        <Select value={selectedGame} onValueChange={setSelectedGame}>
          <SelectTrigger className="w-full md:w-[200px] bg-zinc-900 border-zinc-700 text-white">
            <SelectValue placeholder="Select game" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-900 text-white border-zinc-700">
            <SelectItem value="all">All Games</SelectItem>
            <SelectItem value="Valorant">Valorant</SelectItem>
            <SelectItem value="PUBG">PUBG</SelectItem>
            <SelectItem value="League of Legends">League of Legends</SelectItem>
          </SelectContent>
        </Select>

        {/* Status Tabs */}
        <div className="flex gap-2">
          {["all", "ongoing", "upcoming", "completed"].map((tab) => (
            <Button
              key={tab}
              onClick={() => setFilter(tab)}
              variant={filter === tab ? "default" : "outline"}
              className={cn(
                "capitalize text-sm",
                filter === tab
                  ? "bg-green-500 text-black hover:bg-green-600"
                  : "border-green-500/30 text-green-400 hover:bg-green-500/10"
              )}
            >
              {tab}
            </Button>
          ))}
        </div>
      </div>

      {/* Tournament Grid */}
      <motion.div
        layout
        className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
      >
        {filteredTournaments.map((tournament, index) => (
          <motion.div
            key={tournament.id}
            onClick={() => handleClick(tournament.id.toString())}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <Card className="bg-zinc-900/80 border border-green-500/20 rounded-2xl overflow-hidden hover:shadow-[0_0_20px_rgba(34,197,94,0.25)] hover:border-green-500/40 transition-all backdrop-blur-lg">
              <div className="relative h-40 w-full">
                <Image
                  src={tournament.banner}
                  alt={tournament.name}
                  fill
                  className="object-cover opacity-90"
                />
                <div className="absolute top-2 right-2">
                  <Badge
                    variant="outline"
                    className={cn(
                      "capitalize border text-xs font-medium",
                      statusColors[
                        tournament.status as keyof typeof statusColors
                      ]
                    )}
                  >
                    {tournament.status}
                  </Badge>
                </div>
              </div>

              <CardContent className="p-4 space-y-2">
                <h3 className="text-lg font-semibold text-green-400">
                  {tournament.name}
                </h3>
                <p className="text-sm text-gray-400">{tournament.game}</p>

                <div className="flex justify-between text-sm text-gray-400 mt-2">
                  <span>Prize: {tournament.prizePool}</span>
                  <span>Fee: {tournament.fee}</span>
                </div>

                <p className="text-sm text-gray-500">
                  Starts: {tournament.startDate}
                </p>

                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClick(tournament.id.toString());
                  }}
                  className={cn(
                    "w-full mt-3 font-semibold",
                    tournament.status === "ongoing"
                      ? "bg-green-500 hover:bg-green-600 text-black"
                      : tournament.status === "upcoming"
                      ? "bg-blue-500 hover:bg-blue-600 text-black"
                      : "bg-gray-700 hover:bg-gray-600 text-gray-300"
                  )}
                >
                  {tournament.status === "completed"
                    ? "View Results"
                    : "Join Now"}
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>
    </main>
  );
}
