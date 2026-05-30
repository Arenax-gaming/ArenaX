"use client";

import React from "react";
import NextImage from "next/image";
import { Trophy, TrendingUp, TrendingDown } from "lucide-react";
import { RankChange } from "./RankChange";

interface PlayerRankCardProps {
  username: string;
  avatar?: string;
  currentRank: number;
  eloRating: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  rankChange?: number | null;
  isCurrentUser?: boolean;
}

export const PlayerRankCard: React.FC<PlayerRankCardProps> = ({
  username,
  avatar,
  currentRank,
  eloRating,
  matchesPlayed,
  wins,
  losses,
  winRate,
  rankChange,
  isCurrentUser = false,
}) => {
  const getRankColor = (rank: number) => {
    if (rank <= 10) return "from-yellow-500 to-yellow-600";
    if (rank <= 50) return "from-gray-400 to-gray-500";
    if (rank <= 100) return "from-orange-600 to-orange-700";
    return "from-blue-500 to-blue-600";
  };

  const getTrophyColor = (rank: number) => {
    if (rank <= 10) return "text-yellow-400";
    if (rank <= 50) return "text-gray-300";
    if (rank <= 100) return "text-orange-500";
    return "text-blue-400";
  };

  return (
    <div
      className={`rounded-lg border ${
        isCurrentUser
          ? "border-blue-500 bg-blue-500/10"
          : "border-gray-700 bg-gray-800/50"
      } p-6 backdrop-blur transition-all hover:border-blue-400`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-4">
          {avatar && (
            <NextImage
              src={avatar}
              alt={username}
              width={64}
              height={64}
              className="w-16 h-16 rounded-full border-2 border-gray-700 object-cover"
            />
          )}
          <div>
            <h3 className="text-xl font-bold text-white">{username}</h3>
            {isCurrentUser && (
              <span className="text-xs bg-blue-600 text-white px-2 py-1 rounded mt-1 inline-block">
                Your Rank
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div
            className={`bg-gradient-to-br ${getRankColor(currentRank)} rounded-lg px-4 py-2`}
          >
            <div className="flex items-center gap-2 justify-end">
              <Trophy className={`w-5 h-5 ${getTrophyColor(currentRank)}`} />
              <span className="text-2xl font-bold text-white">
                #{currentRank}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div className="bg-gray-900/50 rounded p-3">
          <p className="text-xs text-gray-400 mb-1">Elo Rating</p>
          <p className="text-lg font-bold text-white">{eloRating}</p>
        </div>
        <div className="bg-gray-900/50 rounded p-3">
          <p className="text-xs text-gray-400 mb-1">Matches</p>
          <p className="text-lg font-bold text-white">{matchesPlayed}</p>
        </div>
        <div className="bg-gray-900/50 rounded p-3">
          <p className="text-xs text-gray-400 mb-1">Wins</p>
          <p className="text-lg font-bold text-green-400">{wins}</p>
        </div>
        <div className="bg-gray-900/50 rounded p-3">
          <p className="text-xs text-gray-400 mb-1">Win Rate</p>
          <p className="text-lg font-bold text-blue-400">
            {(winRate * 100).toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Rank Change */}
      {rankChange !== null && rankChange !== undefined && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-400">Rank Change:</span>
          <RankChange change={rankChange} />
        </div>
      )}

      {/* Win/Loss Ratio */}
      <div className="mt-4 pt-4 border-t border-gray-700">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400">W/L Ratio</span>
          <span className="text-white font-semibold">
            {wins}W - {losses}L
          </span>
        </div>
        <div className="mt-2 w-full bg-gray-900 rounded-full h-2 overflow-hidden">
          <div
            className="bg-gradient-to-r from-green-500 to-blue-500 h-full"
            style={{
              width: `${matchesPlayed > 0 ? (wins / matchesPlayed) * 100 : 0}%`,
            }}
          />
        </div>
      </div>
    </div>
  );
};
