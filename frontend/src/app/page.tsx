import { HeroSection } from "@/components/landing/HeroSection";
import { FeatureSection } from "@/components/landing/FeatureSection";
import { HowItWorksSection } from "@/components/landing/HowItWorksSection";
import { CTASection } from "@/components/landing/CTASection";

export default function Home() {
  return (
    <div className="flex flex-col gap-8 md:gap-12">
      <HeroSection />
      <FeatureSection />
      <HowItWorksSection />
      <CTASection />
    </div>
  );
}
