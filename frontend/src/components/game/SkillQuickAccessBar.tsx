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

export interface FloatingCombatText {
  id: string;
  skillId: string;
  text: string;
  type: "damage" | "heal" | "shield" | "boost";
  x: number;
  y: number;
}

export function SkillQuickAccessBar({
  skills = defaultSkills,
  keyBindings = [],
  onActivateSkill,
  disabled = false,
  className,
  mobileCompact = false,
}: SkillQuickAccessBarProps) {
  const [cooldowns, setCooldowns] = useState<Record<string, { endTime: number; totalMs: number }>>({});
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);
  const [combatFeedback, setCombatFeedback] = useState<FloatingCombatText[]>([]);
  const [now, setNow] = useState<number>(Date.now());

  // Tick for smooth SVG cooldown ring rendering
  useEffect(() => {
    const hasActiveCooldown = Object.values(cooldowns).some((c) => c.endTime > Date.now());
    if (!hasActiveCooldown && combatFeedback.length === 0) return;

    const interval = setInterval(() => {
      setNow(Date.now());
    }, 50);
    return () => clearInterval(interval);
  }, [cooldowns, combatFeedback]);

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
      if (disabled || (cooldowns[skill.id] && cooldowns[skill.id].endTime > Date.now())) {
        return;
      }

      // Visual feedback: button press activation state
      setActiveSkillId(skill.id);
      setTimeout(() => setActiveSkillId(null), 300);

      // Generate floating combat damage/heal visual text feedback
      const feedbackTypes: Record<string, { text: string; type: FloatingCombatText["type"] }> = {
        primary: { text: "-150 DMG", type: "damage" },
        defense: { text: "+100 SHIELD", type: "shield" },
        utility: { text: "+50% SPEED", type: "boost" },
        ultimate: { text: "-450 CRIT DMG!", type: "damage" },
      };
      const feedback = feedbackTypes[skill.category] || { text: "ACTIVATED!", type: "boost" };
      const feedbackItem: FloatingCombatText = {
        id: `fb-${Date.now()}-${Math.random()}`,
        skillId: skill.id,
        text: feedback.text,
        type: feedback.type,
        x: Math.random() * 40 - 20,
        y: -40,
      };

      setCombatFeedback((prev) => [...prev, feedbackItem]);
      setTimeout(() => {
        setCombatFeedback((prev) => prev.filter((f) => f.id !== feedbackItem.id));
      }, 1000);

      onActivateSkill?.(skill);

      // Start cooldown timer
      if (skill.cooldownMs > 0) {
        setCooldowns((prev) => ({
          ...prev,
          [skill.id]: { endTime: Date.now() + skill.cooldownMs, totalMs: skill.cooldownMs },
        }));
      }
    },
    [disabled, cooldowns, onActivateSkill]
  );

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (disabled) return;
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
    <div className="relative">
      {/* Floating Combat Text Feedback Layer (Issue #772) */}
      <div className="absolute -top-12 left-0 right-0 pointer-events-none flex justify-center items-center h-8 z-30">
        {combatFeedback.map((fb) => (
          <span
            key={fb.id}
            data-testid="floating-combat-text"
            className={cn(
              "absolute font-black text-sm px-2 py-0.5 rounded shadow-lg animate-bounce transition-all transform duration-500",
              fb.type === "damage" && "bg-red-600 text-white border border-red-400 scale-110",
              fb.type === "shield" && "bg-cyan-600 text-white border border-cyan-400",
              fb.type === "boost" && "bg-amber-500 text-black border border-amber-300 font-bold"
            )}
            style={{ transform: `translate(${fb.x}px, ${fb.y}px)` }}
          >
            {fb.text}
          </span>
        ))}
      </div>

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
          const cdData = cooldowns[skill.id];
          const cdEndTime = cdData?.endTime || 0;
          const isCooldown = cdEndTime > now;
          const remainingMs = Math.max(0, cdEndTime - now);
          const remainingSeconds = Math.ceil(remainingMs / 1000);
          const progressRatio = isCooldown && cdData ? remainingMs / cdData.totalMs : 0;
          const isActive = activeSkillId === skill.id;

          return (
            <Tooltip key={skill.id}>
              <TooltipTrigger>
                <button
                  type="button"
                  onClick={() => handleTriggerSkill(skill)}
                  disabled={disabled || isCooldown}
                  aria-label={`Activate ${skill.name} (${keyHint || "No key bound"})`}
                  className={cn(
                    "relative group flex flex-col items-center justify-center rounded-xl transition-all duration-150 border select-none overflow-hidden",
                    "min-w-[48px] min-h-[48px] p-2.5",
                    mobileCompact ? "w-12 h-12" : "w-14 h-14 sm:w-16 sm:h-16",
                    skill.category === "ultimate"
                      ? "bg-gradient-to-b from-amber-500/20 to-red-600/20 border-amber-500/40 hover:border-amber-400"
                      : "bg-muted/40 hover:bg-muted/80 border-border/50 hover:border-primary/50",
                    "active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary/60",
                    isActive && "scale-90 ring-4 ring-amber-400 shadow-amber-500/50 shadow-2xl transition-transform duration-75",
                    disabled && "opacity-50 cursor-not-allowed",
                    isCooldown && "opacity-60 cursor-not-allowed"
                  )}
                >
                  {/* Visual Activation Ripple / Aura Particle Burst Effect */}
                  {isActive && (
                    <span
                      data-testid="ability-activation-sparkle"
                      className="absolute inset-0 bg-gradient-to-r from-amber-400/40 via-yellow-300/40 to-amber-500/40 animate-ping rounded-xl pointer-events-none"
                    />
                  )}

                  {/* Skill Icon */}
                  <div className={cn("text-foreground group-hover:scale-110 transition-transform", isActive && "scale-125 text-amber-300")}>
                    {skill.icon || <Sparkles className="w-5 h-5" />}
                  </div>

                  {/* Keybinding Badge Hint */}
                  {keyHint && (
                    <span className="absolute top-1 right-1 px-1 py-0.2 text-[9px] font-mono font-bold bg-background/90 text-foreground border rounded shadow-sm z-10">
                      {keyHint}
                    </span>
                  )}

                  {/* Smooth Animated SVG Cooldown Progress Overlay */}
                  {isCooldown && (
                    <div className="absolute inset-0 bg-background/80 rounded-xl flex items-center justify-center font-bold text-sm text-amber-400 z-20">
                      <svg className="absolute inset-0 w-full h-full p-1" viewBox="0 0 36 36">
                        <path
                          className="text-amber-500/30"
                          strokeWidth="3"
                          stroke="currentColor"
                          fill="none"
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                        <path
                          className="text-amber-400 transition-all duration-75"
                          strokeDasharray={`${progressRatio * 100}, 100`}
                          strokeWidth="3"
                          strokeLinecap="round"
                          stroke="currentColor"
                          fill="none"
                          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        />
                      </svg>
                      <span className="z-10">{remainingSeconds}s</span>
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
    </div>
  );
}

export default SkillQuickAccessBar;
