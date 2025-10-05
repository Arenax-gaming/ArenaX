"use client";

import Footer from "@/components/layout/Footer";
import Header from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, Menu } from "lucide-react";
// import Image from "next/image";
// import { useState } from "react";

export default function Home() {
  // const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Header */}
      <Header />

      {/* Hero Section */}
      <section className="flex-1 flex items-center justify-center text-center px-6 py-12">
        <div className="max-w-3xl">
          <h1 className="text-4xl md:text-6xl font-extrabold text-green-500 mb-6 leading-tight">
            Enter the Future of Competitive Gaming
          </h1>
          <p className="text-base md:text-lg text-gray-300 mb-8">
            ArenaX is your all-in-one esports platform for tournaments, rewards,
            and community. Compete, climb, and conquer with style.
          </p>
          <Button
            size="lg"
            className="bg-green-500 hover:bg-green-600 text-black font-bold w-full md:w-auto"
          >
            Join ArenaX <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16 bg-zinc-950 px-6">
        <div className="container mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
          <Card className="bg-black border-green-500/20">
            <CardContent className="p-6 text-center">
              <h3 className="text-lg md:text-xl font-bold text-green-500 mb-3">
                Tournaments
              </h3>
              <p className="text-gray-400 text-sm md:text-base">
                Join exciting esports events, battle players worldwide, and win
                big rewards.
              </p>
            </CardContent>
          </Card>

          <Card className="bg-black border-green-500/20">
            <CardContent className="p-6 text-center">
              <h3 className="text-lg md:text-xl font-bold text-green-500 mb-3">
                Rewards
              </h3>
              <p className="text-gray-400 text-sm md:text-base">
                Earn tokens, prizes, and bragging rights as you climb the ArenaX
                ladder.
              </p>
            </CardContent>
          </Card>

          <Card className="bg-black border-green-500/20">
            <CardContent className="p-6 text-center">
              <h3 className="text-lg md:text-xl font-bold text-green-500 mb-3">
                Community
              </h3>
              <p className="text-gray-400 text-sm md:text-base">
                Connect with gamers, join teams, and build your legacy in the
                ArenaX world.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <Footer />
    </div>
  );
}
