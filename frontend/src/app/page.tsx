"use client";

import { HeroSection } from "@/components/landing/HeroSection";
import { FeatureSection } from "@/components/landing/FeatureSection";
import { HowItWorksSection } from "@/components/landing/HowItWorksSection";
import { CTASection } from "@/components/landing/CTASection";
import { ActiveTournamentsSection } from "@/components/landing/ActiveTournamentsSection";

export default function Home() {
  return (
    <div className="flex flex-col gap-8 md:gap-12">
      <HeroSection />
      <ActiveTournamentsSection />
      <FeatureSection />
      <HowItWorksSection />
      <CTASection />
    </div>
  );
}
