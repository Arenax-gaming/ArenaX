"use client";

import { useState } from "react";
import {
  Hash,
  TrendingUp,
  Users,
  Award,
  Calendar,
  Filter,
  Grid,
  List,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useSocial } from "@/hooks/useSocial";
import { CommunityFeed } from "@/components/social";
import { currentUser } from "@/data/user";

export default function CommunityPage() {
  const {
    posts,
    likePost,
    addComment,
    createPost,
  } = useSocial();

  const [activeFilter, setActiveFilter] = useState<"all" | "trending" | "recent">("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");

  const filteredPosts = posts
    .sort((a, b) => {
      if (activeFilter === "trending") {
        return b.likes + b.comments * 2 - (a.likes + a.comments * 2);
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })
    .sort((a, b) => {
      // Pinned posts always first
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return 0;
    });

  const handleSharePost = (postId: string) => {
    const url = typeof window !== "undefined"
      ? `${window.location.origin}/community?post=${postId}`
      : "";
    navigator.clipboard.writeText(url);
  };

  const handleReportPost = (postId: string) => {
    console.log("Report post:", postId);
    // In real app, show report modal
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Community</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Connect, share, and engage with the ArenaX community
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className={viewMode === "list" ? "bg-muted" : ""}
            onClick={() => setViewMode("list")}
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={viewMode === "grid" ? "bg-muted" : ""}
            onClick={() => setViewMode("grid")}
          >
            <Grid className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center justify-between border-b pb-1">
        <div className="flex items-center gap-1">
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeFilter === "all"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveFilter("all")}
          >
            All Posts
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeFilter === "trending"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveFilter("trending")}
          >
            <TrendingUp className="h-4 w-4 inline mr-1" />
            Trending
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeFilter === "recent"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveFilter("recent")}
          >
            Recent
          </button>
        </div>
        <Button variant="ghost" size="sm">
          <Filter className="h-4 w-4 mr-2" />
          More Filters
        </Button>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Feed */}
        <div className={`lg:col-span-2 ${viewMode === "grid" ? "" : ""}`}>
          <CommunityFeed
            posts={filteredPosts}
            currentUser={{
              id: currentUser.id,
              username: currentUser.username,
              avatar: currentUser.avatar,
            }}
            onLikePost={likePost}
            onAddComment={addComment}
            onCreatePost={createPost}
            onSharePost={handleSharePost}
            onReportPost={handleReportPost}
          />
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Community Stats */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Users className="h-4 w-4" />
                Community Stats
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center p-3 bg-muted/30 rounded-lg">
                  <div className="text-xl font-bold">12.5K</div>
                  <div className="text-xs text-muted-foreground">Members</div>
                </div>
                <div className="text-center p-3 bg-muted/30 rounded-lg">
                  <div className="text-xl font-bold">3.2K</div>
                  <div className="text-xs text-muted-foreground">Online</div>
                </div>
                <div className="text-center p-3 bg-muted/30 rounded-lg">
                  <div className="text-xl font-bold">847</div>
                  <div className="text-xs text-muted-foreground">Posts Today</div>
                </div>
                <div className="text-center p-3 bg-muted/30 rounded-lg">
                  <div className="text-xl font-bold">156</div>
                  <div className="text-xs text-muted-foreground">Active Threads</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Trending Tags */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Hash className="h-4 w-4" />
                Trending Tags
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {[
                  "tournament",
                  "strategy",
                  "ranked",
                  "tips",
                  "recruitment",
                  "guide",
                  "esports",
                  "milestone",
                ].map((tag) => (
                  <button
                    key={tag}
                    className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-3 py-1.5 rounded-full hover:bg-primary/20 transition-colors"
                  >
                    <Hash className="h-3 w-3" />
                    {tag}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Upcoming Events */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Upcoming Events
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="p-3 bg-muted/30 rounded-lg">
                <div className="text-sm font-medium">Weekly Tournament</div>
                <div className="text-xs text-muted-foreground">
                  Today at 8:00 PM EST
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Prize: 5000 AX tokens
                </div>
              </div>
              <div className="p-3 bg-muted/30 rounded-lg">
                <div className="text-sm font-medium">Community AMA</div>
                <div className="text-xs text-muted-foreground">
                  Tomorrow at 3:00 PM EST
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  With the dev team
                </div>
              </div>
              <div className="p-3 bg-muted/30 rounded-lg">
                <div className="text-sm font-medium">Season 5 Kickoff</div>
                <div className="text-xs text-muted-foreground">
                  March 15, 2026
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  New rewards & features
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Top Contributors */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Award className="h-4 w-4" />
                Top Contributors
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { username: "PhoenixRising", posts: 24, elo: 1480, avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=PhoenixRising" },
                { username: "ShadowNinja", posts: 18, elo: 1380, avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=ShadowNinja" },
                { username: "EliteSniper", posts: 15, elo: 1420, avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=EliteSniper" },
              ].map((user, index) => (
                <div key={user.username} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-muted-foreground w-5 text-center">
                    {index === 0 ? "🥇" : index === 1 ? "🥈" : "🥉"}
                  </span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={user.avatar}
                    alt={user.username}
                    className="h-8 w-8 rounded-full"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {user.username}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {user.posts} posts · ELO {user.elo}
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Community Guidelines */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Guidelines</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>• Be respectful to all community members</li>
                <li>• No spam or self-promotion without context</li>
                <li>• Keep discussions relevant and on-topic</li>
                <li>• Report inappropriate content</li>
                <li>• Have fun and enjoy the community!</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}