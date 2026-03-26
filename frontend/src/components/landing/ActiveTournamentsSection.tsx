"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { TournamentCard } from "@/components/tournaments/TournamentCard";
import { Button } from "@/components/ui/Button";
import { mockTournaments } from "@/data/mockTournaments";
import { ArrowRight } from "lucide-react";

// Filter for active/upcoming tournaments
const activeTournaments = mockTournaments
  .filter((t) => t.status === "registration_open" || t.status === "in_progress")
  .slice(0, 3);

export function ActiveTournamentsSection() {
  return (
    <section className="container py-8 md:py-12 lg:py-16">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="mx-auto flex max-w-[58rem] flex-col items-center justify-center gap-4 text-center"
      >
        <h2 className="font-heading text-3xl leading-[1.1] sm:text-3xl md:text-6xl">
          Active <span className="text-primary">Tournaments</span>
        </h2>
        <p className="max-w-[85%] leading-normal text-muted-foreground sm:text-lg sm:leading-7">
          Join live tournaments and compete for real prizes. New events starting daily.
        </p>
      </motion.div>

      <div className="mx-auto grid justify-center gap-6 sm:grid-cols-2 md:max-w-[64rem] md:grid-cols-3 mt-8">
        {activeTournaments.map((tournament, index) => (
          <motion.div
            key={tournament.id}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: index * 0.1 }}
          >
            <TournamentCard tournament={tournament} />
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.3 }}
        className="flex justify-center mt-8"
      >
        <Link href="/tournaments">
          <Button variant="outline" size="lg" className="gap-2">
            View All Tournaments
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </motion.div>
    </section>
  );
}
