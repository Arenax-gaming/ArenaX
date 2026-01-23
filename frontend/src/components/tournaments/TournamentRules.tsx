import React from "react";
import { Tournament } from "@/types/tournament";
import { Card } from "@/components/ui/Card";
import {
  CheckCircle,
  AlertCircle,
  Users,
  Trophy,
  Clock,
  Shield,
} from "lucide-react";

interface TournamentRulesProps {
  tournament: Tournament;
}

export function TournamentRules({ tournament }: TournamentRulesProps) {
  // Generate mock rules based on tournament type
  const getRulesContent = () => {
    const baseRules = [
      {
        icon: CheckCircle,
        title: "Eligibility",
        description:
          "Players must be 18+ years old and have a valid account to participate in this tournament.",
        color: "text-green-600",
      },
      {
        icon: Clock,
        title: "Check-in Requirement",
        description:
          "Players must check in 15 minutes before their match starts. Failure to do so results in forfeit.",
        color: "text-blue-600",
      },
      {
        icon: Users,
        title: `Format: ${tournament.tournamentType.charAt(0).toUpperCase() + tournament.tournamentType.slice(1)}`,
        description:
          tournament.tournamentType === "elimination"
            ? "Single elimination bracket. One loss results in elimination from the tournament."
            : tournament.tournamentType === "round-robin"
              ? "Round-robin format where all players face each other. Final standings determined by win-loss record."
              : tournament.tournamentType === "swiss"
                ? "Swiss system format with multiple rounds of pairing based on performance."
                : "Best of 3 series for each match. First to 2 wins advances.",
        color: "text-purple-600",
      },
      {
        icon: AlertCircle,
        title: "Disqualification",
        description:
          "Players will be disqualified for: cheating, abusive conduct, failure to show up, or violating tournament rules.",
        color: "text-red-600",
      },
      {
        icon: Trophy,
        title: "Prize Distribution",
        description:
          "Prizes are awarded based on final placement. All payouts are processed within 7 business days after tournament completion.",
        color: "text-amber-600",
      },
      {
        icon: Shield,
        title: "Fair Play",
        description:
          "All players are expected to play fairly and honestly. Exploiting bugs, lag switching, or account sharing is strictly prohibited.",
        color: "text-indigo-600",
      },
    ];

    return baseRules;
  };

  const rules = getRulesContent();

  return (
    <Card className="border-0 shadow-none p-0">
      <div className="border-b p-6 md:p-8">
        <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
          Tournament Rules & Information
        </h2>
        <p className="text-muted-foreground">
          Please read the rules carefully before joining the tournament.
        </p>
      </div>

      {/* Rules Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 md:p-8">
        {rules.map((rule, index) => {
          const Icon = rule.icon;
          return (
            <div
              key={index}
              className="bg-card border rounded-lg p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start gap-4">
                <div className={`flex-shrink-0 p-2 bg-background rounded-lg`}>
                  <Icon className={`h-6 w-6 ${rule.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-foreground mb-1">
                    {rule.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {rule.description}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Additional Info Section */}
      <div className="bg-blue-50 dark:bg-blue-950/20 border-t border-blue-200 dark:border-blue-900 p-6 md:p-8">
        <div className="flex gap-3">
          <AlertCircle className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
              Important: Before You Join
            </h4>
            <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
              <li>
                • Ensure you have a stable internet connection for all matches
              </li>
              <li>
                • Your account will be charged $
                {tournament.entryFee === 0
                  ? "nothing (free entry)"
                  : `$${tournament.entryFee}`}{" "}
                upon confirmation
              </li>
              <li>
                • By joining, you agree to follow all tournament rules and code
                of conduct
              </li>
              <li>
                • In case of disputes, tournament organizers' decisions are
                final
              </li>
            </ul>
          </div>
        </div>
      </div>
    </Card>
  );
}
