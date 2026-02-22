import { Metadata } from "next";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/Card";
import { Shield, Zap, Globe, Users } from "lucide-react";

export const metadata: Metadata = {
  title: "About - ArenaX",
  description: "Learn about ArenaX, the decentralized competitive gaming platform built on Stellar/Soroban.",
};

const team = [
  {
    name: "Alex Chen",
    role: "Founder & Lead Developer",
    image: "https://api.dicebear.com/7.x/avataaars/svg?seed=Alex",
    bio: "Former professional gamer turned blockchain developer. Passionate about fair play and decentralized systems.",
  },
  {
    name: "Sarah Johnson",
    role: "Head of Product",
    image: "https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah",
    bio: "10+ years in gaming industry. Previously led product at major esports platforms.",
  },
  {
    name: "Michael Rodriguez",
    role: "Smart Contract Developer",
    image: "https://api.dicebear.com/7.x/avataaars/svg?seed=Michael",
    bio: "Soroban expert and Stellar ecosystem contributor. Building secure, scalable contracts.",
  },
  {
    name: "Emily Wong",
    role: "UX/UI Designer",
    image: "https://api.dicebear.com/7.x/avataaars/svg?seed=Emily",
    bio: "Creating beautiful, accessible interfaces that gamers love. Specializing in gaming & fintech design.",
  },
];

const values = [
  {
    icon: Shield,
    title: "Fairness First",
    description: "Every match is verified on-chain. Our smart contracts ensure transparent results and instant prize distribution.",
  },
  {
    icon: Zap,
    title: "Lightning Fast",
    description: "Built on Stellar for low-cost, high-speed transactions. No more waiting days for your winnings.",
  },
  {
    icon: Globe,
    title: "Truly Global",
    description: "Anyone can participate regardless of location. We support players from over 150 countries.",
  },
  {
    icon: Users,
    title: "Community Driven",
    description: "Players own the platform. Governance tokens give you a voice in future development.",
  },
];

export default function AboutPage() {
  return (
    <div className="container py-8 md:py-12 lg:py-24">
      {/* Hero Section */}
      <section className="mx-auto max-w-[64rem] text-center mb-16">
        <h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl mb-6">
          About <span className="text-primary">ArenaX</span>
        </h1>
        <p className="text-xl text-muted-foreground max-w-[42rem] mx-auto">
          The future of competitive gaming is decentralized, transparent, and accessible to everyone.
        </p>
      </section>

      {/* Story Section */}
      <section className="mx-auto max-w-[64rem] mb-16">
        <div className="grid gap-8 md:grid-cols-2 items-center">
          <div>
            <h2 className="font-heading text-3xl font-bold mb-4">Our Story</h2>
            <div className="space-y-4 text-muted-foreground">
              <p>
                ArenaX was born from a simple frustration: the gaming industry is plagued by 
                match-fixing, delayed payouts, and opaque tournament systems. We knew there 
                had to be a better way.
              </p>
              <p>
                Founded in 2024 by a team of gamers and blockchain developers, we set out to 
                create a platform where skill truly determines the outcome—and where winnings 
                are delivered instantly, transparently, and globally.
              </p>
              <p>
                By leveraging Stellar&apos;s lightning-fast blockchain and Soroban&apos;s smart contract 
                capabilities, we&apos;ve built a tournament platform that eliminates the middlemen 
                and puts players first.
              </p>
            </div>
          </div>
          <div className="bg-muted/50 rounded-3xl p-8">
            <h3 className="font-heading text-2xl font-bold mb-4">Our Vision</h3>
            <p className="text-muted-foreground mb-6">
              To become the world&apos;s most trusted competitive gaming platform by making every 
              match verifiable, every prize instant, and every player empowered.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-4 bg-background rounded-xl">
                <div className="text-3xl font-bold text-primary">500K+</div>
                <div className="text-sm text-muted-foreground">Players</div>
              </div>
              <div className="text-center p-4 bg-background rounded-xl">
                <div className="text-3xl font-bold text-primary">$10M+</div>
                <div className="text-sm text-muted-foreground">Prize Paid</div>
              </div>
              <div className="text-center p-4 bg-background rounded-xl">
                <div className="text-3xl font-bold text-primary">50K+</div>
                <div className="text-sm text-muted-foreground">Matches</div>
              </div>
              <div className="text-center p-4 bg-background rounded-xl">
                <div className="text-3xl font-bold text-primary">150+</div>
                <div className="text-sm text-muted-foreground">Countries</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Decentralization Section */}
      <section className="mx-auto max-w-[64rem] mb-16">
        <div className="bg-primary text-primary-foreground rounded-3xl p-8 md:p-12">
          <h2 className="font-heading text-3xl font-bold mb-6 text-center">
            Built on Stellar & Soroban
          </h2>
          <div className="grid gap-6 md:grid-cols-3">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-white/20 mb-4">
                <Zap className="h-6 w-6" />
              </div>
              <h3 className="font-bold text-lg mb-2">Lightning Fast</h3>
              <p className="text-primary-foreground/80 text-sm">
                3-5 second transaction finality. Say goodbye to waiting for confirmations.
              </p>
            </div>
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-white/20 mb-4">
                <Shield className="h-6 w-6" />
              </div>
              <h3 className="font-bold text-lg mb-2">Ultra Low Cost</h3>
              <p className="text-primary-foreground/80 text-sm">
                Fraction of a cent per transaction. Maximize your winnings, not fees.
              </p>
            </div>
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-white/20 mb-4">
                <Globe className="h-6 w-6" />
              </div>
              <h3 className="font-bold text-lg mb-2">Global Access</h3>
              <p className="text-primary-foreground/80 text-sm">
                No borders. Players from anywhere can join, compete, and get paid instantly.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Values Section */}
      <section className="mx-auto max-w-[64rem] mb-16">
        <h2 className="font-heading text-3xl font-bold mb-8 text-center">Our Values</h2>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {values.map((value) => (
            <Card key={value.title} className="border-none bg-muted/50">
              <CardContent className="pt-6">
                <value.icon className="h-10 w-10 text-primary mb-4" />
                <h3 className="font-bold text-lg mb-2">{value.title}</h3>
                <p className="text-sm text-muted-foreground">{value.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Team Section */}
      <section className="mx-auto max-w-[64rem]">
        <h2 className="font-heading text-3xl font-bold mb-8 text-center">Meet the Team</h2>
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          {team.map((member) => (
            <Card key={member.name} className="border-none bg-muted/50 overflow-hidden">
              <div className="aspect-square relative bg-gradient-to-br from-primary/20 to-primary/5">
                <Image
                  src={member.image}
                  alt={member.name}
                  fill
                  className="object-cover"
                />
              </div>
              <CardContent className="pt-4">
                <h3 className="font-bold text-lg">{member.name}</h3>
                <p className="text-sm text-primary mb-2">{member.role}</p>
                <p className="text-sm text-muted-foreground">{member.bio}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
