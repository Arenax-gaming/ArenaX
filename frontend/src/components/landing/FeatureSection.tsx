import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Trophy, Zap, Shield, Users, Wallet, Swords } from "lucide-react";

const features = [
  {
    title: "Instant Payouts",
    description:
      "Win and withdraw instantly via Stripe, Bank Transfer, or Crypto.",
    icon: Wallet,
  },
  {
    title: "Anti-Cheat Protection",
    description: "AI-driven cheat detection ensures fair play in every match.",
    icon: Shield,
  },
  {
    title: "Daily Tournaments",
    description:
      "Join automated tournaments for your favorite games every day.",
    icon: Trophy,
  },
  {
    title: "Skill-Based Matchmaking",
    description:
      "Compete against players of your skill level for fair matches.",
    icon: Swords,
  },
  {
    title: "Community Driven",
    description: "Create your own tournaments and build a following.",
    icon: Users,
  },
  {
    title: "Lightning Fast",
    description: "Built on Stellar for low-cost, high-speed transactions.",
    icon: Zap,
  },
];

export function FeatureSection() {
  return (
    <section className="container space-y-6 py-8 md:py-12 lg:py-24 bg-muted/50 rounded-3xl my-8">
      <div className="mx-auto flex max-w-[58rem] flex-col items-center space-y-4 text-center">
        <h2 className="font-heading text-3xl leading-[1.1] sm:text-3xl md:text-6xl">
          Features designed for <span className="text-primary">Gamers</span>
        </h2>
        <p className="max-w-[85%] leading-normal text-muted-foreground sm:text-lg sm:leading-7">
          ArenaX combines cutting-edge technology with seamless user experience
          to bring you the best competitive platform.
        </p>
      </div>
      <div className="mx-auto grid justify-center gap-4 sm:grid-cols-2 md:max-w-[64rem] md:grid-cols-3">
        {features.map((feature) => (
          <Card
            key={feature.title}
            className="bg-background border-none shadow-sm transition-all hover:shadow-md"
          >
            <CardHeader>
              <feature.icon className="h-10 w-10 text-primary mb-2" />
              <CardTitle className="text-xl">{feature.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {feature.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
