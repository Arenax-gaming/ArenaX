import { User, EloPoint } from "@/types/user";

export const mockEloHistory: EloPoint[] = [
  { date: "2026-01-01", elo: 1000 },
  { date: "2026-01-08", elo: 1050 },
  { date: "2026-01-15", elo: 1030 },
  { date: "2026-01-22", elo: 1100 },
  { date: "2026-01-29", elo: 1150 },
  { date: "2026-02-05", elo: 1120 },
  { date: "2026-02-12", elo: 1200 },
  { date: "2026-02-19", elo: 1250 },
];

export const currentUser: User = {
  id: "user-123",
  username: "ProGamer99",
  email: "pro@arenax.com",
  isVerified: true,
  avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=ProGamer99",
  bio: "Competitive CS2 and Valorant player. Always looking for the next challenge. Founder of Team Zenith.",
  socialLinks: {
    twitter: "https://twitter.com/progamer99",
    discord: "ProGamer#0001",
    twitch: "https://twitch.tv/progamer99",
  },
  elo: 1250,
  createdAt: "2026-01-01T10:00:00Z",
};
