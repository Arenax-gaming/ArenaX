"use client";

import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  checkPasswordStrength,
  type PasswordStrength,
} from "@/lib/validations/auth";

interface PasswordStrengthIndicatorProps {
  password: string;
  className?: string;
}

export const PasswordStrengthIndicator = ({
  password,
  className,
}: PasswordStrengthIndicatorProps) => {
  if (!password) return null;

  const strength: PasswordStrength = checkPasswordStrength(password);

  const requirements = [
    { label: "At least 8 characters", met: strength.requirements.hasMinLength },
    { label: "One uppercase letter", met: strength.requirements.hasUppercase },
    { label: "One lowercase letter", met: strength.requirements.hasLowercase },
    { label: "One number", met: strength.requirements.hasNumber },
    { label: "One special character", met: strength.requirements.hasSpecialChar },
  ];

  const strengthPercentage = (strength.score / 5) * 100;

  const getBarColor = () => {
    if (strength.score <= 2) return "bg-red-500";
    if (strength.score === 3) return "bg-orange-500";
    if (strength.score === 4) return "bg-yellow-500";
    return "bg-green-500";
  };

  return (
    <div className={cn("space-y-3 mt-3", className)} role="status" aria-live="polite">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Password strength</span>
          <span className={cn("font-medium", strength.color)}>
            {strength.label}
          </span>
        </div>
        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full transition-all duration-300 ease-out rounded-full",
              getBarColor()
            )}
            style={{ width: `${strengthPercentage}%` }}
            role="progressbar"
            aria-valuenow={strength.score}
            aria-valuemin={0}
            aria-valuemax={5}
            aria-label={`Password strength: ${strength.label}`}
          />
        </div>
      </div>

      <ul className="space-y-1.5" aria-label="Password requirements">
        {requirements.map((req) => (
          <li
            key={req.label}
            className="flex items-center gap-2 text-sm"
          >
            {req.met ? (
              <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
            ) : (
              <X className="h-4 w-4 text-muted-foreground/50 flex-shrink-0" />
            )}
            <span
              className={cn(
                "transition-colors duration-200",
                req.met ? "text-green-600" : "text-muted-foreground"
              )}
            >
              {req.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};
