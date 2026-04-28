import { getPasswordStrength } from "@/lib/validations/auth";
import { Check, X } from "lucide-react";

interface PasswordStrengthIndicatorProps {
  password: string;
}

export function PasswordStrengthIndicator({
  password,
}: PasswordStrengthIndicatorProps) {
  if (!password) return null;

  const strength = getPasswordStrength(password);

  const requirements = [
    { key: "minLength", label: "At least 8 characters" },
    { key: "hasUppercase", label: "One uppercase letter" },
    { key: "hasLowercase", label: "One lowercase letter" },
    { key: "hasNumber", label: "One number" },
    { key: "hasSpecial", label: "One special character" },
  ];

  return (
    <div className="space-y-3" role="region" aria-label="Password strength indicator">
      {/* Strength Bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            Password Strength
          </span>
          <span className={`text-xs font-semibold ${strength.color}`}>
            {strength.label}
          </span>
        </div>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((level) => (
            <div
              key={level}
              className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                level <= strength.score
                  ? strength.score <= 2
                    ? "bg-destructive"
                    : strength.score <= 3
                    ? "bg-yellow-500"
                    : "bg-green-500"
                  : "bg-muted"
              }`}
              aria-hidden="true"
            />
          ))}
        </div>
      </div>

      {/* Requirements List */}
      <ul className="space-y-1.5" aria-label="Password requirements">
        {requirements.map(({ key, label }) => {
          const met = strength.requirements[key as keyof typeof strength.requirements];
          return (
            <li
              key={key}
              className="flex items-center gap-2 text-xs"
              aria-label={`${label}: ${met ? "met" : "not met"}`}
            >
              {met ? (
                <Check className="h-3.5 w-3.5 text-green-500" aria-hidden="true" />
              ) : (
                <X className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              )}
              <span className={met ? "text-green-600" : "text-muted-foreground"}>
                {label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
