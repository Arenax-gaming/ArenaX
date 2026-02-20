"use client";

import { Button } from "@/components/ui/Button";
import Link from "next/link";
import { motion } from "framer-motion";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-background pb-16 pt-20 md:pb-32 md:pt-32 lg:pb-40 lg:pt-40">
      <div className="container relative z-10 flex max-w-[64rem] flex-col items-center gap-4 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center rounded-lg bg-muted px-3 py-1 text-sm font-medium"
        >
          🎉 <span className="ml-1">Season 1 is now live</span>
        </motion.div>
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="font-heading text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl"
        >
          Competitive Gaming <br className="hidden sm:inline" />
          <span className="text-primary">Evolved</span>
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="max-w-[42rem] leading-normal text-muted-foreground sm:text-xl sm:leading-8"
        >
          Join the ultimate platform for amateur gamers. Compete in daily
          tournaments, get instant payouts, and build your reputation on the
          blockchain.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="flex w-full flex-col gap-4 sm:w-auto sm:flex-row"
        >
          <Link href="/register" className="w-full sm:w-auto">
            <Button size="lg" className="h-11 w-full px-8 sm:w-auto hover:scale-105 transition-transform">
              Start Competing
            </Button>
          </Link>
          <Link href="/tournaments" className="w-full sm:w-auto">
            <Button
              variant="outline"
              size="lg"
              className="h-11 w-full px-8 sm:w-auto hover:scale-105 transition-transform"
            >
              View Tournaments
            </Button>
          </Link>
        </motion.div>
      </div>

      {/* Background decoration with parallax effect */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.2 }}
        transition={{ duration: 1 }}
        className="absolute left-1/2 top-1/2 -z-10 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 dark:opacity-10"
      >
        <div className="h-full w-full rounded-full bg-primary blur-[100px]" />
      </motion.div>
      
      {/* Floating decorative elements */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 0.1, scale: 1 }}
        transition={{ duration: 1.5, delay: 0.5 }}
        className="absolute -left-32 top-1/4 -z-10 h-64 w-64 rounded-full bg-primary blur-[80px] dark:opacity-5"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 0.1, scale: 1 }}
        transition={{ duration: 1.5, delay: 0.7 }}
        className="absolute -right-32 bottom-1/4 -z-10 h-64 w-64 rounded-full bg-primary blur-[80px] dark:opacity-5"
      />
    </section>
  );
}
