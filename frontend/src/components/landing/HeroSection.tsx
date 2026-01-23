import { Button } from "@/components/ui/Button";
import Link from "next/link";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-background pb-16 pt-20 md:pb-32 md:pt-32 lg:pb-40 lg:pt-40">
      <div className="container relative z-10 flex max-w-[64rem] flex-col items-center gap-4 text-center">
        <div className="inline-flex items-center rounded-lg bg-muted px-3 py-1 text-sm font-medium">
          🎉 <span className="ml-1">Season 1 is now live</span>
        </div>
        <h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
          Competitive Gaming <br className="hidden sm:inline" />
          <span className="text-primary">Evolved</span>
        </h1>
        <p className="max-w-[42rem] leading-normal text-muted-foreground sm:text-xl sm:leading-8">
          Join the ultimate platform for amateur gamers. Compete in daily
          tournaments, get instant payouts, and build your reputation on the
          blockchain.
        </p>
        <div className="flex w-full flex-col gap-4 sm:w-auto sm:flex-row">
          <Link href="/register" className="w-full sm:w-auto">
            <Button size="lg" className="h-11 w-full px-8 sm:w-auto">
              Start Competing
            </Button>
          </Link>
          <Link href="/tournaments" className="w-full sm:w-auto">
            <Button
              variant="outline"
              size="lg"
              className="h-11 w-full px-8 sm:w-auto"
            >
              View Tournaments
            </Button>
          </Link>
        </div>
      </div>

      {/* Background decoration */}
      <div className="absolute left-1/2 top-1/2 -z-10 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 opacity-20 dark:opacity-10">
        <div className="h-full w-full rounded-full bg-primary blur-[100px]" />
      </div>
    </section>
  );
}
