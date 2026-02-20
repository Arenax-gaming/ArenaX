"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronUp, HelpCircle } from "lucide-react";

const faqs = [
  {
    question: "How do I create an account?",
    answer: "Simply click the 'Register' button on our homepage and fill in your email and desired password. You can also sign up using your Google or Discord account for faster registration.",
  },
  {
    question: "How do I join a tournament?",
    answer: "Navigate to the Tournaments page, browse available events, and click 'Join Tournament' on any event with open registration. You'll need to pay the entry fee (if any) to secure your spot.",
  },
  {
    question: "How are match results verified?",
    answer: "We use a combination of AI-powered anti-cheat systems and on-chain verification. All match results are recorded on the Stellar blockchain for complete transparency.",
  },
  {
    question: "How do I withdraw my winnings?",
    answer: "Go to your Wallet page, click 'Withdraw', and enter your Stellar wallet address or select a supported payment method. Withdrawals are processed instantly thanks to Stellar's fast transaction finality.",
  },
  {
    question: "What games are supported?",
    answer: "We currently support major titles including Counter-Strike 2, Valorant, League of Legends, Dota 2, Fortnite, Overwatch 2, and many more. We're constantly adding new games based on community demand.",
  },
  {
    question: "How do I report a cheater?",
    answer: "If you suspect another player of cheating, you can report them directly from the match results page or contact our support team with evidence. We take all reports seriously and investigate promptly.",
  },
  {
    question: "Is ArenaX available in my country?",
    answer: "ArenaX is available in over 150 countries worldwide. Some features may be restricted based on local regulations. Check our Terms of Service for more information about regional availability.",
  },
  {
    question: "How can I partner with ArenaX?",
    answer: "We're always looking for brand partnerships, tournament organizers, and content creators. Contact our partnerships team through this form by selecting 'Partnership' as the category.",
  },
];

export function FAQSection() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HelpCircle className="h-5 w-5" />
          Frequently Asked Questions
        </CardTitle>
        <CardDescription>
          Find quick answers to common questions about ArenaX.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {faqs.map((faq, index) => (
          <div
            key={index}
            className="border rounded-lg overflow-hidden"
          >
            <button
              onClick={() => setOpenFaq(openFaq === index ? null : index)}
              className="flex items-center justify-between w-full p-4 text-left hover:bg-muted/50 transition-colors"
            >
              <span className="font-medium text-sm">{faq.question}</span>
              {openFaq === index ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              )}
            </button>
            <AnimatePresence>
              {openFaq === index && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="px-4 pb-4 text-sm text-muted-foreground">
                    {faq.answer}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
