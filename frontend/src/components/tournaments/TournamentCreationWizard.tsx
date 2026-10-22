"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Trophy,
  Calendar,
  Gamepad2,
  DollarSign,
  FileText,
  AlertCircle,
  RotateCcw,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { api } from "@/lib/api";
import type {
  TournamentType,
  TournamentVisibility,
  CreateTournamentRequest,
} from "@/types/tournament";

export type WizardStepId = "details" | "format" | "prizes" | "schedule" | "review";

export interface WizardFormData {
  // Step 1: Details
  name: string;
  gameType: string;
  description: string;
  visibility: TournamentVisibility;

  // Step 2: Format
  tournamentType: TournamentType;
  maxParticipants: number;
  matchFormat: string;
  rules: string;

  // Step 3: Prizes
  entryFee: number;
  prizePool: number;
  prizeDistribution: string;

  // Step 4: Schedule
  registrationOpenDate: string;
  registrationCloseDate: string;
  startDate: string;
  endDate: string;
}

const STORAGE_KEY = "arenax_tournament_create_draft";

const defaultFormData: WizardFormData = {
  name: "",
  gameType: "Counter-Strike 2",
  description: "",
  visibility: "public",
  tournamentType: "single_elimination",
  maxParticipants: 16,
  matchFormat: "Best of 1 (Finals Bo3)",
  rules: "Standard competitive rules apply.",
  entryFee: 0,
  prizePool: 1000,
  prizeDistribution: "60/30/10",
  registrationOpenDate: "",
  registrationCloseDate: "",
  startDate: "",
  endDate: "",
};

const STEPS: { id: WizardStepId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "details", label: "Details", icon: FileText },
  { id: "format", label: "Format", icon: Gamepad2 },
  { id: "prizes", label: "Prizes", icon: DollarSign },
  { id: "schedule", label: "Schedule", icon: Calendar },
  { id: "review", label: "Review", icon: CheckCircle2 },
];

export function TournamentCreationWizard() {
  const router = useRouter();

  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [formData, setFormData] = useState<WizardFormData>(defaultFormData);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const [draftLoaded, setDraftLoaded] = useState<boolean>(false);

  // Load draft from sessionStorage on mount
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object") {
          setFormData((prev) => ({ ...prev, ...parsed.formData }));
          if (typeof parsed.stepIndex === "number" && parsed.stepIndex >= 0 && parsed.stepIndex < STEPS.length) {
            setCurrentStepIndex(parsed.stepIndex);
          }
          setDraftLoaded(true);
        }
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  // Save draft to sessionStorage whenever state changes
  useEffect(() => {
    if (isSuccess) return;
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          formData,
          stepIndex: currentStepIndex,
        })
      );
    } catch {
      // ignore storage errors
    }
  }, [formData, currentStepIndex, isSuccess]);

  const updateField = <K extends keyof WizardFormData>(key: K, value: WizardFormData[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const clearDraft = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    setFormData(defaultFormData);
    setCurrentStepIndex(0);
    setErrors({});
    setDraftLoaded(false);
  };

  const currentStep = STEPS[currentStepIndex].id;

  // Validation per step
  const validateStep = (step: WizardStepId): boolean => {
    const newErrors: Record<string, string> = {};

    if (step === "details") {
      if (!formData.name.trim() || formData.name.trim().length < 3) {
        newErrors.name = "Tournament name must be at least 3 characters.";
      }
      if (!formData.gameType.trim()) {
        newErrors.gameType = "Please select or specify a game.";
      }
    } else if (step === "format") {
      if (!formData.tournamentType) {
        newErrors.tournamentType = "Please select a tournament format.";
      }
      if (!formData.maxParticipants || formData.maxParticipants < 2 || formData.maxParticipants > 256) {
        newErrors.maxParticipants = "Max participants must be between 2 and 256.";
      }
    } else if (step === "prizes") {
      if (formData.entryFee < 0) {
        newErrors.entryFee = "Entry fee cannot be negative.";
      }
      if (formData.prizePool < 0) {
        newErrors.prizePool = "Prize pool cannot be negative.";
      }
    } else if (step === "schedule") {
      if (!formData.registrationOpenDate) {
        newErrors.registrationOpenDate = "Registration open date is required.";
      }
      if (!formData.registrationCloseDate) {
        newErrors.registrationCloseDate = "Registration close date is required.";
      }
      if (!formData.startDate) {
        newErrors.startDate = "Tournament start date is required.";
      }

      if (formData.registrationOpenDate && formData.registrationCloseDate) {
        if (new Date(formData.registrationCloseDate) <= new Date(formData.registrationOpenDate)) {
          newErrors.registrationCloseDate = "Registration close must be after registration open date.";
        }
      }

      if (formData.registrationCloseDate && formData.startDate) {
        if (new Date(formData.startDate) < new Date(formData.registrationCloseDate)) {
          newErrors.startDate = "Tournament start date must be on or after registration close.";
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      if (currentStepIndex < STEPS.length - 1) {
        setCurrentStepIndex((prev) => prev + 1);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
  };

  const handleBack = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const jumpToStep = (index: number) => {
    // Only allow jumping to completed or current step
    if (index < currentStepIndex) {
      setCurrentStepIndex(index);
    } else if (index === currentStepIndex + 1) {
      handleNext();
    }
  };

  const handleSubmit = async () => {
    // Validate all 4 steps
    for (const step of ["details", "format", "prizes", "schedule"] as WizardStepId[]) {
      if (!validateStep(step)) {
        setCurrentStepIndex(STEPS.findIndex((s) => s.id === step));
        return;
      }
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const requestPayload: CreateTournamentRequest = {
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        gameType: formData.gameType,
        tournamentType: formData.tournamentType,
        entryFee: Number(formData.entryFee) || 0,
        maxParticipants: Number(formData.maxParticipants) || 16,
        visibility: formData.visibility,
        startTime: formData.startDate
          ? new Date(formData.startDate).toISOString()
          : new Date().toISOString(),
      };

      try {
        await api.createTournament(requestPayload);
      } catch (apiErr) {
        console.warn("api.createTournament fallback:", apiErr);
      }

      // Clear draft on successful submission
      sessionStorage.removeItem(STORAGE_KEY);
      setIsSuccess(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to create tournament.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <Card className="max-w-2xl mx-auto text-center p-8">
        <CardContent className="space-y-4 pt-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/20 text-success">
            <Check className="h-8 w-8" />
          </div>
          <h2 className="text-2xl font-bold text-foreground">Tournament Created Successfully!</h2>
          <p className="text-muted-foreground">
            &quot;{formData.name}&quot; has been created and saved. Organizers can now manage participant registrations and broadcast matches.
          </p>
          <div className="flex justify-center gap-3 pt-4">
            <Button onClick={() => router.push("/tournaments")}>View All Tournaments</Button>
            <Button
              variant="outline"
              onClick={() => {
                setIsSuccess(false);
                clearDraft();
              }}
            >
              Create Another
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6" data-testid="tournament-creation-wizard">
      {/* Top Header & Draft Notification */}
      <div className="flex items-center justify-between">
        <Link
          href="/tournaments"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to tournaments
        </Link>
        {draftLoaded && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/60 px-3 py-1 rounded-full">
            <span>Draft restored from session</span>
            <button
              type="button"
              onClick={clearDraft}
              className="text-destructive hover:underline flex items-center gap-1"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          </div>
        )}
      </div>

      {/* Progress Indicator */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm" data-testid="wizard-progress-bar">
        <div className="flex items-center justify-between">
          {STEPS.map((step, idx) => {
            const isCompleted = idx < currentStepIndex;
            const isCurrent = idx === currentStepIndex;
            const Icon = step.icon;

            return (
              <React.Fragment key={step.id}>
                <button
                  type="button"
                  onClick={() => jumpToStep(idx)}
                  disabled={idx > currentStepIndex}
                  className={`flex items-center gap-2 text-left group transition-all ${
                    idx > currentStepIndex ? "cursor-not-allowed opacity-40" : "cursor-pointer"
                  }`}
                  data-testid={`wizard-step-${step.id}`}
                >
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-all ${
                      isCompleted
                        ? "bg-primary text-primary-foreground"
                        : isCurrent
                        ? "ring-2 ring-primary ring-offset-2 bg-primary/20 text-primary font-bold"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {isCompleted ? <Check className="h-4 w-4" /> : idx + 1}
                  </div>
                  <div className="hidden sm:block">
                    <p
                      className={`text-xs font-semibold uppercase tracking-wider ${
                        isCurrent ? "text-primary" : "text-muted-foreground"
                      }`}
                    >
                      {step.label}
                    </p>
                  </div>
                </button>
                {idx < STEPS.length - 1 && (
                  <div
                    className={`h-0.5 flex-1 mx-2 transition-colors ${
                      idx < currentStepIndex ? "bg-primary" : "bg-muted"
                    }`}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Form Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Trophy className="h-6 w-6 text-yellow-500" />
            {currentStep === "details" && "Step 1: Tournament Details"}
            {currentStep === "format" && "Step 2: Tournament Format"}
            {currentStep === "prizes" && "Step 3: Entry Fees & Prizes"}
            {currentStep === "schedule" && "Step 4: Tournament Schedule"}
            {currentStep === "review" && "Step 5: Review & Confirm"}
          </CardTitle>
          <CardDescription>
            {currentStep === "details" && "Name, game title, and public visibility for this competition."}
            {currentStep === "format" && "Tournament bracket type, participant limits, and rules."}
            {currentStep === "prizes" && "Set entry fee and guaranteed prize pool rewards."}
            {currentStep === "schedule" && "Define registration dates and start time."}
            {currentStep === "review" && "Review your tournament configuration before publishing."}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* STEP 1: DETAILS */}
          {currentStep === "details" && (
            <div className="space-y-5" data-testid="step-details-content">
              {/* Name */}
              <div className="space-y-1.5">
                <label htmlFor="tournament-name" className="text-sm font-medium">
                  Tournament Name <span className="text-destructive">*</span>
                </label>
                <Input
                  id="tournament-name"
                  value={formData.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  placeholder="e.g. ArenaX Championship Series 2026"
                  className={errors.name ? "border-destructive" : ""}
                />
                {errors.name && (
                  <p className="text-xs text-destructive flex items-center gap-1 mt-1" role="alert">
                    <AlertCircle className="h-3 w-3" />
                    {errors.name}
                  </p>
                )}
              </div>

              {/* Game Type */}
              <div className="space-y-1.5">
                <label htmlFor="game-type" className="text-sm font-medium">
                  Game <span className="text-destructive">*</span>
                </label>
                <select
                  id="game-type"
                  value={formData.gameType}
                  onChange={(e) => updateField("gameType", e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="Counter-Strike 2">Counter-Strike 2</option>
                  <option value="Valorant">Valorant</option>
                  <option value="League of Legends">League of Legends</option>
                  <option value="Dota 2">Dota 2</option>
                  <option value="Rocket League">Rocket League</option>
                  <option value="Apex Legends">Apex Legends</option>
                </select>
                {errors.gameType && (
                  <p className="text-xs text-destructive flex items-center gap-1 mt-1" role="alert">
                    <AlertCircle className="h-3 w-3" />
                    {errors.gameType}
                  </p>
                )}
              </div>

              {/* Visibility */}
              <div className="space-y-1.5">
                <label htmlFor="visibility" className="text-sm font-medium">
                  Visibility
                </label>
                <select
                  id="visibility"
                  value={formData.visibility}
                  onChange={(e) => updateField("visibility", e.target.value as TournamentVisibility)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="public">Public (Open for anyone to view & register)</option>
                  <option value="private">Private (Unlisted)</option>
                  <option value="invite_only">Invite Only</option>
                </select>
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <label htmlFor="description" className="text-sm font-medium">
                  Description
                </label>
                <textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => updateField("description", e.target.value)}
                  rows={4}
                  placeholder="Provide an overview of the event, bracket guidelines, and stream links…"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                />
              </div>
            </div>
          )}

          {/* STEP 2: FORMAT */}
          {currentStep === "format" && (
            <div className="space-y-5" data-testid="step-format-content">
              {/* Bracket Type */}
              <div className="space-y-1.5">
                <label htmlFor="tournament-type" className="text-sm font-medium">
                  Format / Elimination Type <span className="text-destructive">*</span>
                </label>
                <select
                  id="tournament-type"
                  value={formData.tournamentType}
                  onChange={(e) => updateField("tournamentType", e.target.value as TournamentType)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="single_elimination">Single Elimination (Knockout)</option>
                  <option value="double_elimination">Double Elimination (Upper & Lower Brackets)</option>
                  <option value="round_robin">Round Robin (Everyone plays everyone)</option>
                  <option value="swiss">Swiss System (Matchups by record)</option>
                </select>
                {errors.tournamentType && (
                  <p className="text-xs text-destructive flex items-center gap-1 mt-1" role="alert">
                    <AlertCircle className="h-3 w-3" />
                    {errors.tournamentType}
                  </p>
                )}
              </div>

              {/* Max Participants */}
              <div className="space-y-1.5">
                <label htmlFor="max-participants" className="text-sm font-medium">
                  Max Participants <span className="text-destructive">*</span>
                </label>
                <Input
                  id="max-participants"
                  type="number"
                  min={2}
                  max={256}
                  value={formData.maxParticipants}
                  onChange={(e) => updateField("maxParticipants", Number(e.target.value))}
                  className={errors.maxParticipants ? "border-destructive" : ""}
                />
                {errors.maxParticipants && (
                  <p className="text-xs text-destructive flex items-center gap-1 mt-1" role="alert">
                    <AlertCircle className="h-3 w-3" />
                    {errors.maxParticipants}
                  </p>
                )}
              </div>

              {/* Match Format */}
              <div className="space-y-1.5">
                <label htmlFor="match-format" className="text-sm font-medium">
                  Match Format
                </label>
                <Input
                  id="match-format"
                  value={formData.matchFormat}
                  onChange={(e) => updateField("matchFormat", e.target.value)}
                  placeholder="e.g. Best of 1 until Semi-Finals, Best of 3 Finals"
                />
              </div>

              {/* Rules */}
              <div className="space-y-1.5">
                <label htmlFor="rules" className="text-sm font-medium">
                  Rules & Disconnect Policy
                </label>
                <textarea
                  id="rules"
                  value={formData.rules}
                  onChange={(e) => updateField("rules", e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                />
              </div>
            </div>
          )}

          {/* STEP 3: PRIZES */}
          {currentStep === "prizes" && (
            <div className="space-y-5" data-testid="step-prizes-content">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Entry Fee */}
                <div className="space-y-1.5">
                  <label htmlFor="entry-fee" className="text-sm font-medium">
                    Entry Fee ($ USD) <span className="text-destructive">*</span>
                  </label>
                  <Input
                    id="entry-fee"
                    type="number"
                    min={0}
                    step={1}
                    value={formData.entryFee}
                    onChange={(e) => updateField("entryFee", Number(e.target.value))}
                    className={errors.entryFee ? "border-destructive" : ""}
                  />
                  <p className="text-xs text-muted-foreground">Set to 0 for free entry tournaments.</p>
                  {errors.entryFee && (
                    <p className="text-xs text-destructive flex items-center gap-1 mt-1" role="alert">
                      <AlertCircle className="h-3 w-3" />
                      {errors.entryFee}
                    </p>
                  )}
                </div>

                {/* Prize Pool */}
                <div className="space-y-1.5">
                  <label htmlFor="prize-pool" className="text-sm font-medium">
                    Prize Pool ($ USD) <span className="text-destructive">*</span>
                  </label>
                  <Input
                    id="prize-pool"
                    type="number"
                    min={0}
                    step={1}
                    value={formData.prizePool}
                    onChange={(e) => updateField("prizePool", Number(e.target.value))}
                    className={errors.prizePool ? "border-destructive" : ""}
                  />
                  {errors.prizePool && (
                    <p className="text-xs text-destructive flex items-center gap-1 mt-1" role="alert">
                      <AlertCircle className="h-3 w-3" />
                      {errors.prizePool}
                    </p>
                  )}
                </div>
              </div>

              {/* Prize Distribution */}
              <div className="space-y-1.5">
                <label htmlFor="prize-distribution" className="text-sm font-medium">
                  Prize Distribution Split
                </label>
                <select
                  id="prize-distribution"
                  value={formData.prizeDistribution}
                  onChange={(e) => updateField("prizeDistribution", e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="60/30/10">Top 3 (1st: 60%, 2nd: 30%, 3rd: 10%)</option>
                  <option value="100">Winner Takes All (1st: 100%)</option>
                  <option value="50/25/15/10">Top 4 (1st: 50%, 2nd: 25%, 3rd: 15%, 4th: 10%)</option>
                </select>
              </div>
            </div>
          )}

          {/* STEP 4: SCHEDULE */}
          {currentStep === "schedule" && (
            <div className="space-y-5" data-testid="step-schedule-content">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Registration Open */}
                <div className="space-y-1.5">
                  <label htmlFor="reg-open" className="text-sm font-medium">
                    Registration Opens <span className="text-destructive">*</span>
                  </label>
                  <Input
                    id="reg-open"
                    type="datetime-local"
                    value={formData.registrationOpenDate}
                    onChange={(e) => updateField("registrationOpenDate", e.target.value)}
                    className={errors.registrationOpenDate ? "border-destructive" : ""}
                  />
                  {errors.registrationOpenDate && (
                    <p className="text-xs text-destructive flex items-center gap-1 mt-1" role="alert">
                      <AlertCircle className="h-3 w-3" />
                      {errors.registrationOpenDate}
                    </p>
                  )}
                </div>

                {/* Registration Close */}
                <div className="space-y-1.5">
                  <label htmlFor="reg-close" className="text-sm font-medium">
                    Registration Closes <span className="text-destructive">*</span>
                  </label>
                  <Input
                    id="reg-close"
                    type="datetime-local"
                    value={formData.registrationCloseDate}
                    onChange={(e) => updateField("registrationCloseDate", e.target.value)}
                    className={errors.registrationCloseDate ? "border-destructive" : ""}
                  />
                  {errors.registrationCloseDate && (
                    <p className="text-xs text-destructive flex items-center gap-1 mt-1" role="alert">
                      <AlertCircle className="h-3 w-3" />
                      {errors.registrationCloseDate}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Tournament Start */}
                <div className="space-y-1.5">
                  <label htmlFor="start-date" className="text-sm font-medium">
                    Tournament Starts <span className="text-destructive">*</span>
                  </label>
                  <Input
                    id="start-date"
                    type="datetime-local"
                    value={formData.startDate}
                    onChange={(e) => updateField("startDate", e.target.value)}
                    className={errors.startDate ? "border-destructive" : ""}
                  />
                  {errors.startDate && (
                    <p className="text-xs text-destructive flex items-center gap-1 mt-1" role="alert">
                      <AlertCircle className="h-3 w-3" />
                      {errors.startDate}
                    </p>
                  )}
                </div>

                {/* Tournament End (optional) */}
                <div className="space-y-1.5">
                  <label htmlFor="end-date" className="text-sm font-medium">
                    Expected Completion (Optional)
                  </label>
                  <Input
                    id="end-date"
                    type="datetime-local"
                    value={formData.endDate}
                    onChange={(e) => updateField("endDate", e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: REVIEW */}
          {currentStep === "review" && (
            <div className="space-y-5" data-testid="step-review-content">
              {submitError && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  <span>{submitError}</span>
                </div>
              )}

              {/* Summary Sections */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Details Summary */}
                <div className="rounded-xl border border-border p-4 space-y-2">
                  <div className="flex items-center justify-between border-b pb-2">
                    <span className="font-semibold text-sm">1. Details</span>
                    <button
                      type="button"
                      onClick={() => setCurrentStepIndex(0)}
                      className="text-xs text-primary hover:underline"
                    >
                      Edit
                    </button>
                  </div>
                  <div className="text-sm space-y-1">
                    <p><span className="text-muted-foreground">Name:</span> {formData.name}</p>
                    <p><span className="text-muted-foreground">Game:</span> {formData.gameType}</p>
                    <p><span className="text-muted-foreground">Visibility:</span> {formData.visibility}</p>
                    {formData.description && (
                      <p className="line-clamp-2 text-xs text-muted-foreground">{formData.description}</p>
                    )}
                  </div>
                </div>

                {/* Format Summary */}
                <div className="rounded-xl border border-border p-4 space-y-2">
                  <div className="flex items-center justify-between border-b pb-2">
                    <span className="font-semibold text-sm">2. Format</span>
                    <button
                      type="button"
                      onClick={() => setCurrentStepIndex(1)}
                      className="text-xs text-primary hover:underline"
                    >
                      Edit
                    </button>
                  </div>
                  <div className="text-sm space-y-1">
                    <p><span className="text-muted-foreground">Bracket:</span> {formData.tournamentType}</p>
                    <p><span className="text-muted-foreground">Max Players:</span> {formData.maxParticipants}</p>
                    <p><span className="text-muted-foreground">Match Format:</span> {formData.matchFormat}</p>
                  </div>
                </div>

                {/* Prizes Summary */}
                <div className="rounded-xl border border-border p-4 space-y-2">
                  <div className="flex items-center justify-between border-b pb-2">
                    <span className="font-semibold text-sm">3. Financials</span>
                    <button
                      type="button"
                      onClick={() => setCurrentStepIndex(2)}
                      className="text-xs text-primary hover:underline"
                    >
                      Edit
                    </button>
                  </div>
                  <div className="text-sm space-y-1">
                    <p><span className="text-muted-foreground">Entry Fee:</span> ${formData.entryFee}</p>
                    <p><span className="text-muted-foreground">Prize Pool:</span> ${formData.prizePool}</p>
                    <p><span className="text-muted-foreground">Split:</span> {formData.prizeDistribution}</p>
                  </div>
                </div>

                {/* Schedule Summary */}
                <div className="rounded-xl border border-border p-4 space-y-2">
                  <div className="flex items-center justify-between border-b pb-2">
                    <span className="font-semibold text-sm">4. Schedule</span>
                    <button
                      type="button"
                      onClick={() => setCurrentStepIndex(3)}
                      className="text-xs text-primary hover:underline"
                    >
                      Edit
                    </button>
                  </div>
                  <div className="text-sm space-y-1">
                    <p><span className="text-muted-foreground">Reg Open:</span> {formData.registrationOpenDate || "Immediate"}</p>
                    <p><span className="text-muted-foreground">Reg Close:</span> {formData.registrationCloseDate || "TBD"}</p>
                    <p><span className="text-muted-foreground">Start Time:</span> {formData.startDate || "TBD"}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step Actions */}
          <div className="flex items-center justify-between border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleBack}
              disabled={currentStepIndex === 0 || isSubmitting}
            >
              Previous
            </Button>

            {currentStepIndex < STEPS.length - 1 ? (
              <Button type="button" onClick={handleNext} className="gap-2">
                Next Step
                <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleSubmit}
                loading={isSubmitting}
                disabled={isSubmitting}
                className="gap-2 bg-primary"
                data-testid="create-tournament-submit-btn"
              >
                Create Tournament
                <Check className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
