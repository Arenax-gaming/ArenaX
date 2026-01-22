import Link from "next/link";
import { Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  onClick?: () => void;
}

export function Logo({ className, onClick }: LogoProps) {
  return (
    <Link
      href="/"
      className={cn("flex items-center gap-2 font-bold", className)}
      onClick={onClick}
    >
      <Trophy className="h-5 w-5 text-primary" />
      <span className="text-sm sm:text-base">ArenaX</span>
    </Link>
  );
}
