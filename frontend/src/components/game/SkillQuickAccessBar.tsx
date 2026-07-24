"use client";

import React, { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/Tooltip";
import type { KeyBinding } from "@/types/settings";
import { Zap, Shield, Flame, Sparkles, Crosshair } from "lucide-react";

export interface SkillItem {
  id: string;
  name: string;
  actionName: string;
  description: string;
  icon?: React.ReactNode;
  cooldownMs: number;
  manaCost?: number;
  category: "primary" | "utility" | "defense" | "ultimate";
}

export const defaultSkills: SkillItem[] = [
  {
    id: "skill_1",
    name: "Plasma Blast",
    actionName: "Skill 1 (Primary)",
    description: "Fires a concentrated energy projectile dealing high direct damage.",
    icon: <Crosshair className="w-5 h-5" />,
    cooldownMs: 2000,
    manaCost: 15,
    category: "primary",
  },
  {
    id: "skill_2",
    name: "Barrier Shield",
    actionName: "Skill 2 (Secondary)",
    description: "Deploys a temporary protective barrier absorbing incoming damage.",
    icon: <Shield className="w-5 h-5" />,
    cooldownMs: 8000,
    manaCost: 35,
    category: "defense",
  },
  {
    id: "skill_3",
    name: "Hyper Dash",
    actionName: "Skill 3 (Utility)",
    description: "Rapidly dashes in direction of movement, granting invulnerability frames.",
    icon: <Zap className="w-5 h-5" />,
    cooldownMs: 5000,
    manaCost: 20,
    category: "utility",
  },
  {
    id: "skill_4",
    name: "Supernova Strike",
    actionName: "Skill 4 (Ultimate)",
    description: "Unleashes an explosive area-of-effect blast obliterating nearby enemies.",
    icon: <Flame className="w-5 h-5" />,
    cooldownMs: 30000,
    manaCost: 100,
    category: "ultimate",
  },
  {
    id: "skill_boost",
    name: "Overdrive Boost",
    actionName: "Skill Quick Boost",
    description: "Instantly recharges attack speed and movement velocity for 5 seconds.",
    icon: <Sparkles className="w-5 h-5" />,
    cooldownMs: 15000,
    manaCost: 40,
    category: "utility",
  },
];

interface SkillQuickAccessBarProps {
  skills?: SkillItem[];
  keyBindings?: KeyBinding[];
  onActivateSkill?: (skill: SkillItem) => void;
  disabled?: boolean;
  className?: string;
  mobileCompact?: boolean;
}

export function SkillQuickAccessBar({
  skills = defaultSkills,
  keyBindings = [],
  onActivateSkill,
  disabled = false,
  className,
  mobileCompact = false,
}: SkillQuickAccessBarProps) {
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({});

  // Helper to format key binding text with modifier
  const getKeyHint = useCallback(
    (actionName: string): string => {
      const binding = keyBindings.find((b) => b.action === actionName);
      if (!binding) return "";
      const mod = binding.modifier && binding.modifier !== "None" ? `${binding.modifier}+` : "";
      return `${mod}${binding.primaryKey}`;
    },
    [keyBindings]
  );

  const handleTriggerSkill = useCallback(
    (skill: SkillItem) => {
      if (disabled || (cooldowns[skill.id] && cooldowns[skill.id] > Date.now())) {
        return;
      }

      onActivateSkill?.(skill);

      // Start cooldown timer
      if (skill.cooldownMs > 0) {
        setCooldowns((prev) => ({
          ...prev,
          [skill.id]: Date.now() + skill.cooldownMs,
        }));
      }
    },
    [disabled, cooldowns, onActivateSkill]
  );

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (disabled) return;
      // Don't trigger if user is typing in input or textarea
      if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) return;

      for (const skill of skills) {
        const binding = keyBindings.find((b) => b.action === skill.actionName);
        if (!binding) continue;

        const pressedKey = e.key.toUpperCase();
        const primaryKey = binding.primaryKey.toUpperCase();

        const needsCtrl = binding.modifier === "Ctrl";
        const needsShift = binding.modifier === "Shift";
        const needsAlt = binding.modifier === "Alt";

        const ctrlMatch = needsCtrl ? e.ctrlKey : !e.ctrlKey;
        const shiftMatch = needsShift ? e.shiftKey : !e.shiftKey;
        const altMatch = needsAlt ? e.altKey : !e.altKey;

        if (pressedKey === primaryKey && ctrlMatch && shiftMatch && altMatch) {
          e.preventDefault();
          handleTriggerSkill(skill);
          break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [disabled, skills, keyBindings, handleTriggerSkill]);

  return (
    <div
      aria-label="Skill quick-access menu"
      className={cn(
        "flex items-center justify-center gap-2 p-2 bg-background/85 backdrop-blur-md rounded-2xl border border-border/40 shadow-xl",
        "mobile:flex-wrap mobile:justify-around max-w-full overflow-x-auto",
        className
      )}
    >
      {skills.map((skill) => {
        const keyHint = getKeyHint(skill.actionName);
        const cdEndTime = cooldowns[skill.id] || 0;
        const isCooldown = cdEndTime > Date.now();
        const remainingSeconds = isCooldown ? Math.ceil((cdEndTime - Date.now()) / 1000) : 0;

        return (
          <Tooltip key={skill.id}>
            <TooltipTrigger>
              <button
                type="button"
                onClick={() => handleTriggerSkill(skill)}
                disabled={disabled || isCooldown}
                aria-label={`Activate ${skill.name} (${keyHint || 'No key bound'})`}
                className={cn(
                  "relative group flex flex-col items-center justify-center rounded-xl transition-all duration-150 border select-none",
                  // Minimum 44x44px touch target requirement
                  "min-w-[48px] min-h-[48px] p-2.5",
                  mobileCompact ? "w-12 h-12" : "w-14 h-14 sm:w-16 sm:h-16",
                  skill.category === "ultimate"
                    ? "bg-gradient-to-b from-amber-500/20 to-red-600/20 border-amber-500/40 hover:border-amber-400"
                    : "bg-muted/40 hover:bg-muted/80 border-border/50 hover:border-primary/50",
                  "active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary/60",
                  disabled && "opacity-50 cursor-not-allowed",
                  isCooldown && "opacity-60 cursor-not-allowed"
                )}
              >
                {/* Skill Icon */}
                <div className="text-foreground group-hover:scale-110 transition-transform">
                  {skill.icon || <Sparkles className="w-5 h-5" />}
                </div>

                {/* Keybinding Badge Hint */}
                {keyHint && (
                  <span className="absolute top-1 right-1 px-1 py-0.2 text-[9px] font-mono font-bold bg-background/90 text-foreground border rounded shadow-sm">
                    {keyHint}
                  </span>
                )}

                {/* Cooldown Overlay */}
                {isCooldown && (
                  <div className="absolute inset-0 bg-background/80 rounded-xl flex items-center justify-center font-bold text-sm text-amber-400">
                    {remainingSeconds}s
                  </div>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <div className="p-1 space-y-1 text-xs">
                <div className="font-bold flex items-center justify-between gap-2">
                  <span>{skill.name}</span>
                  {keyHint && (
                    <span className="px-1.5 py-0.5 bg-primary/20 text-primary border border-primary/30 rounded text-[10px] font-mono">
                      {keyHint}
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground">{skill.description}</p>
                <div className="flex items-center gap-3 text-[10px] text-foreground/70">
                  <span>Cooldown: {skill.cooldownMs / 1000}s</span>
                  {skill.manaCost && <span>Mana: {skill.manaCost}</span>}
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

export default SkillQuickAccessBar;
