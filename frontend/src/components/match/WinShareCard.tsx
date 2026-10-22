"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { generateWinShareCard } from "@/api/winShareCard";

export interface WinShareCardProps {
  playerName: string;
  gameName: string;
  tournamentName: string;
}

function makeFilename(playerName: string): string {
  const playerSlug = playerName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${playerSlug || "player"}-arenax-win.png`;
}

export function WinShareCard({
  playerName,
  gameName,
  tournamentName,
}: WinShareCardProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState("");

  const downloadCard = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("Win card downloaded.");
  };

  const handleShare = async () => {
    setIsGenerating(true);
    setStatus("");

    try {
      const blob = await generateWinShareCard({ playerName, gameName, tournamentName });
      const filename = makeFilename(playerName);
      const file = new File([blob], filename, { type: "image/png" });

      if (
        typeof navigator.share === "function" &&
        (!navigator.canShare || navigator.canShare({ files: [file] }))
      ) {
        try {
          await navigator.share({
            files: [file],
            title: `${playerName} won ${tournamentName}`,
            text: `${playerName} won ${tournamentName} playing ${gameName} on ArenaX!`,
          });
          setStatus("Win card shared.");
          return;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") return;
        }
      }

      downloadCard(blob, filename);
    } catch {
      setStatus("The win card could not be generated. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div>
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={handleShare}
        loading={isGenerating}
        loadingLabel="Generating win card"
        aria-label="Share win card"
      >
        <Share2 className="h-4 w-4" aria-hidden="true" />
        Share Win
      </Button>
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}