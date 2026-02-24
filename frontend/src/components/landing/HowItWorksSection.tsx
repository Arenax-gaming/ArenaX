"use client";

import { motion } from "framer-motion";
import { UserPlus, Trophy, Swords, Wallet } from "lucide-react";

const steps = [
  {
    number: "01",
    title: "Sign Up",
    description:
      "Create an account in seconds using your email or social login.",
    icon: UserPlus,
  },
  {
    number: "02",
    title: "Join Tournament",
    description: "Browse daily tournaments for your game and skill level.",
    icon: Trophy,
  },
  {
    number: "03",
    title: "Compete & Win",
    description:
      "Play your matches and report scores with our automated system.",
    icon: Swords,
  },
  {
    number: "04",
    title: "Get Paid",
    description:
      "Receive your prize money instantly to your preferred local wallet.",
    icon: Wallet,
  },
];

export function HowItWorksSection() {
  return (
    <section className="container py-8 md:py-12 lg:py-24">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="mx-auto flex max-w-[58rem] flex-col items-center justify-center gap-4 text-center"
      >
        <h2 className="font-heading text-3xl leading-[1.1] sm:text-3xl md:text-6xl">
          How it Works
        </h2>
        <p className="max-w-[85%] leading-normal text-muted-foreground sm:text-lg sm:leading-7">
          Start your journey to becoming a pro gamer in four simple steps.
        </p>
      </motion.div>
      <div className="mx-auto grid justify-center gap-8 sm:grid-cols-2 md:max-w-[64rem] md:grid-cols-4 mt-12">
        {steps.map((step, index) => (
          <motion.div
            key={step.number}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: index * 0.1 }}
            className="relative flex flex-col items-center text-center gap-2 px-4"
          >
            <span className="text-6xl font-bold text-muted/30 absolute -top-8 select-none">
              {step.number}
            </span>
            <div className="relative z-10 flex flex-col items-center gap-2">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-2">
                <step.icon className="h-8 w-8 text-primary" />
              </div>
              <h3 className="font-bold text-xl">{step.title}</h3>
              <p className="text-sm text-muted-foreground">
                {step.description}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
