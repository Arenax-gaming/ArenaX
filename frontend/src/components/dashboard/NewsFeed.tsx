"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { RefreshCw } from "lucide-react";

interface NewsItem {
  id: string;
  title: string;
  summary: string;
  tag: string;
  date: string;
}

const mockNews: NewsItem[] = [
  { id: "n1", title: "Season 3 Begins April 30", summary: "New ranked season kicks off with updated ELO brackets and exclusive rewards for top players.", tag: "Season", date: "2026-04-24" },
  { id: "n2", title: "CS2 Pro League Finals This Weekend", summary: "The top 8 teams battle it out for the $10,000 prize pool. Watch live on our platform.", tag: "Tournament", date: "2026-04-22" },
  { id: "n3", title: "New Anti-Cheat System Deployed", summary: "We've rolled out enhanced detection to keep matches fair for everyone.", tag: "Update", date: "2026-04-20" },
  { id: "n4", title: "Valorant Cup Registration Open", summary: "Sign up now for the upcoming Valorant Cup. Limited spots available.", tag: "Tournament", date: "2026-04-18" },
  { id: "n5", title: "Platform Maintenance May 1", summary: "Scheduled downtime from 2–4 AM UTC for infrastructure upgrades.", tag: "Notice", date: "2026-04-17" },
];

const tagColors: Record<string, string> = {
  Season: "bg-purple-500/10 text-purple-500",
  Tournament: "bg-yellow-500/10 text-yellow-600",
  Update: "bg-primary/10 text-primary",
  Notice: "bg-muted text-muted-foreground",
};

const PAGE_SIZE = 3;

interface NewsFeedProps {
  news?: NewsItem[];
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

function NewsFeedSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="h-4 w-32 bg-muted rounded animate-pulse" />
      </CardHeader>
      <CardContent className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="h-4 w-16 bg-muted rounded-full animate-pulse" />
              <div className="h-3 w-20 bg-muted rounded animate-pulse" />
            </div>
            <div className="h-4 w-3/4 bg-muted rounded animate-pulse" />
            <div className="h-3 w-full bg-muted rounded animate-pulse" />
            <div className="h-3 w-5/6 bg-muted rounded animate-pulse" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function NewsFeedError({ onRetry }: { onRetry?: () => void }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Platform News</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-8 text-center">
        <p className="text-sm text-muted-foreground">Could not load news — please try again.</p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function NewsFeed({ news = mockNews, isLoading = false, isError = false, onRetry }: NewsFeedProps) {
  const [page, setPage] = useState(1);

  if (isLoading) return <NewsFeedSkeleton />;
  if (isError) return <NewsFeedError onRetry={onRetry} />;

  const visible = news.slice(0, page * PAGE_SIZE);
  const hasMore = visible.length < news.length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Platform News</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {visible.map((item) => (
          <div key={item.id} className="space-y-1">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tagColors[item.tag] ?? "bg-muted text-muted-foreground"}`}>
                {item.tag}
              </span>
              <span className="text-xs text-muted-foreground">{new Date(item.date).toLocaleDateString()}</span>
            </div>
            <p className="text-sm font-semibold leading-snug">{item.title}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">{item.summary}</p>
          </div>
        ))}
        {hasMore && (
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setPage((p) => p + 1)}>
            Load more
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
