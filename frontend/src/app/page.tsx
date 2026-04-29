"use client";

import dynamic from "next/dynamic";
import { HeroSection } from "@/components/landing/HeroSection";

const ActiveTournamentsSection = dynamic(() => import("@/components/landing/ActiveTournamentsSection").then(mod => mod.ActiveTournamentsSection), {
  loading: () => <div className="h-96 animate-pulse bg-muted rounded-xl" />,
  ssr: true,
});

const FeatureSection = dynamic(() => import("@/components/landing/FeatureSection").then(mod => mod.FeatureSection), {
  loading: () => <div className="h-96 animate-pulse bg-muted rounded-xl" />,
  ssr: true,
});

const HowItWorksSection = dynamic(() => import("@/components/landing/HowItWorksSection").then(mod => mod.HowItWorksSection), {
  loading: () => <div className="h-96 animate-pulse bg-muted rounded-xl" />,
  ssr: true,
});

const CTASection = dynamic(() => import("@/components/landing/CTASection").then(mod => mod.CTASection), {
  loading: () => <div className="h-64 animate-pulse bg-muted rounded-xl" />,
  ssr: true,
});

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
