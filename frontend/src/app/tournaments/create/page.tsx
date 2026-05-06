"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormError } from "@/components/ui/FormError";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ChevronRight, 
  ChevronLeft, 
  Check, 
  Save, 
  Eye, 
  Share2, 
  Copy, 
  Twitter, 
  Facebook,
  Trophy,
  Calendar,
  Users,
  DollarSign,
  Gamepad2
} from "lucide-react";
import { TournamentType, TournamentVisibility } from "@/types/tournament";

type Step = 1 | 2 | 3 | 4 | "preview" | "success";

interface TournamentFormData {
  // Step 1: Basic Info
  name: string;
  gameType: string;
  description: string;
  // Step 2: Format & Rules
  tournamentType: TournamentType;
  matchFormat: string;
  rules: string;
  // Step 3: Entry & Prizes
  entryFee: number;
  prizePool: number;
  prizeDistribution: string;
  // Step 4: Schedule & Registration
  visibility: TournamentVisibility;
  maxParticipants: number;
  registrationOpenDate: string;
  registrationCloseDate: string;
  startDate: string;
  endDate: string;
}

const initialFormData: TournamentFormData = {
  name: "",
  gameType: "",
  description: "",
  tournamentType: "single_elimination",
  matchFormat: "bo3",
  rules: "",
  entryFee: 0,
  prizePool: 0,
  prizeDistribution: "",
  visibility: "public",
  maxParticipants: 16,
  registrationOpenDate: "",
  registrationCloseDate: "",
  startDate: "",
  endDate: "",
};

const gameTypes = [
  "League of Legends",
  "Valorant",
  "Counter-Strike 2",
  "Dota 2",
  "Fortnite",
  "Rocket League",
  "Apex Legends",
  "Overwatch 2",
  "Street Fighter 6",
  "Super Smash Bros",
  "Other",
];

const matchFormats = [
  { value: "bo1", label: "Best of 1" },
  { value: "bo3", label: "Best of 3" },
  { value: "bo5", label: "Best of 5" },
  { value: "bo7", label: "Best of 7" },
];

const tournamentTypes: { value: TournamentType; label: string; description: string }[] = [
  { value: "single_elimination", label: "Single Elimination", description: "Lose once and you're out" },
  { value: "double_elimination", label: "Double Elimination", description: "Two chances before elimination" },
  { value: "round_robin", label: "Round Robin", description: "Everyone plays everyone" },
  { value: "swiss", label: "Swiss System", description: "Pairings based on performance" },
];

export default function CreateTournamentPage() {
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [formData, setFormData] = useState<TournamentFormData>(initialFormData);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [createdTournamentId, setCreatedTournamentId] = useState<string>("");

  // Load draft from localStorage on mount
  useEffect(() => {
    const savedDraft = localStorage.getItem("tournament_draft");
    if (savedDraft) {
      try {
        const parsed = JSON.parse(savedDraft);
        setFormData(parsed);
        setDraftSaved(true);
      } catch (e) {
        console.error("Failed to load draft:", e);
      }
    }
  }, []);

  // Save draft to localStorage
  const saveDraft = useCallback(() => {
    setIsSaving(true);
    localStorage.setItem("tournament_draft", JSON.stringify(formData));
    setTimeout(() => {
      setIsSaving(false);
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 2000);
    }, 500);
  }, [formData]);

  // Auto-save draft on form changes
  useEffect(() => {
    const timer = setTimeout(() => {
      saveDraft();
    }, 1000);
    return () => clearTimeout(timer);
  }, [formData, saveDraft]);

  const validateStep = (step: Step): boolean => {
    const newErrors: Record<string, string> = {};

    if (step === 1) {
      if (!formData.name.trim()) newErrors.name = "Tournament name is required";
      if (!formData.gameType) newErrors.gameType = "Game type is required";
      if (!formData.description.trim()) newErrors.description = "Description is required";
    }

    if (step === 2) {
      if (!formData.matchFormat) newErrors.matchFormat = "Match format is required";
      if (!formData.rules.trim()) newErrors.rules = "Rules are required";
    }

    if (step === 3) {
      if (formData.entryFee < 0) newErrors.entryFee = "Entry fee cannot be negative";
      if (formData.prizePool < 0) newErrors.prizePool = "Prize pool cannot be negative";
      if (formData.prizePool > 0 && !formData.prizeDistribution.trim()) {
        newErrors.prizeDistribution = "Prize distribution is required when prize pool is set";
      }
    }

    if (step === 4) {
      if (!formData.registrationOpenDate) newErrors.registrationOpenDate = "Registration open date is required";
      if (!formData.registrationCloseDate) newErrors.registrationCloseDate = "Registration close date is required";
      if (!formData.startDate) newErrors.startDate = "Start date is required";
      if (formData.maxParticipants < 2) newErrors.maxParticipants = "Minimum 2 participants required";
      
      if (formData.registrationOpenDate && formData.registrationCloseDate) {
        if (new Date(formData.registrationOpenDate) >= new Date(formData.registrationCloseDate)) {
          newErrors.registrationCloseDate = "Registration close date must be after open date";
        }
      }
      
      if (formData.startDate && formData.registrationCloseDate) {
        if (new Date(formData.registrationCloseDate) > new Date(formData.startDate)) {
          newErrors.startDate = "Start date must be after registration close date";
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep((prev) => (prev === 4 ? "preview" : (prev as Step) + 1) as Step);
    }
  };

  const handleBack = () => {
    setCurrentStep((prev) => (prev === "preview" ? 4 : (prev as Step) - 1) as Step);
  };

  const handleFieldChange = (field: keyof TournamentFormData, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear error for this field
    if (errors[field]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  const handleSubmit = async () => {
    if (!validateStep(4)) return;
    
    setIsSubmitting(true);
    
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 2000));
    
    // Generate mock tournament ID
    const tournamentId = `t_${Date.now()}`;
    setCreatedTournamentId(tournamentId);
    
    // Clear draft
    localStorage.removeItem("tournament_draft");
    
    setCurrentStep("success");
    setIsSubmitting(false);
  };

  const handleCopyLink = () => {
    const link = `${window.location.origin}/tournaments/${createdTournamentId}`;
    navigator.clipboard.writeText(link);
  };

  const steps = [
    { number: 1, title: "Basic Info", icon: Gamepad2 },
    { number: 2, title: "Format & Rules", icon: Trophy },
    { number: 3, title: "Entry & Prizes", icon: DollarSign },
    { number: 4, title: "Schedule", icon: Calendar },
  ];

  return (
    <div className="min-h-screen px-4 py-8 bg-background">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-2">
            Create Tournament
          </h1>
          <p className="text-muted-foreground">
            Set up your tournament in a few simple steps
          </p>
        </div>

        {/* Progress Indicator */}
        {currentStep !== "success" && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              {steps.map((step, index) => {
                const Icon = step.icon;
                const isActive = currentStep === step.number;
                const isCompleted = (typeof currentStep === "number" && currentStep > step.number) || currentStep === "preview";
                
                return (
                  <div key={step.number} className="flex items-center flex-1">
                    <div className="flex flex-col items-center flex-1">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                          isActive
                            ? "border-blue-600 bg-blue-600 text-white"
                            : isCompleted
                            ? "border-green-600 bg-green-600 text-white"
                            : "border-gray-300 bg-background text-muted-foreground"
                        }`}
                      >
                        {isCompleted ? (
                          <Check className="h-5 w-5" />
                        ) : (
                          <Icon className="h-5 w-5" />
                        )}
                      </div>
                      <span
                        className={`text-xs mt-2 font-medium ${
                          isActive ? "text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {step.title}
                      </span>
                    </div>
                    {index < steps.length - 1 && (
                      <div
                        className={`flex-1 h-0.5 mx-2 transition-all ${
                          isCompleted ? "bg-green-600" : "bg-gray-300"
                        }`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            
            {/* Draft saved indicator */}
            <div className="flex justify-center">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Save className="h-4 w-4" />
                <span>Draft {draftSaved ? "saved" : "auto-saving..."}</span>
              </div>
            </div>
          </div>
        )}

        {/* Form Content */}
        <AnimatePresence mode="wait">
          {currentStep === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle>Basic Information</CardTitle>
                  <CardDescription>
                    Tell us about your tournament
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <label htmlFor="name" className="text-sm font-medium">
                      Tournament Name <span className="text-red-500">*</span>
                    </label>
                    <Input
                      id="name"
                      placeholder="e.g., Summer Championship 2024"
                      value={formData.name}
                      onChange={(e) => handleFieldChange("name", e.target.value)}
                      error={!!errors.name}
                    />
                    {errors.name && <p className="text-sm text-red-500">{errors.name}</p>}
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="gameType" className="text-sm font-medium">
                      Game <span className="text-red-500">*</span>
                    </label>
                    <select
                      id="gameType"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={formData.gameType}
                      onChange={(e) => handleFieldChange("gameType", e.target.value)}
                    >
                      <option value="">Select a game</option>
                      {gameTypes.map((game) => (
                        <option key={game} value={game}>
                          {game}
                        </option>
                      ))}
                    </select>
                    {errors.gameType && <p className="text-sm text-red-500">{errors.gameType}</p>}
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="description" className="text-sm font-medium">
                      Description <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      id="description"
                      className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 placeholder:text-muted-foreground"
                      placeholder="Describe your tournament, its format, and what makes it special..."
                      value={formData.description}
                      onChange={(e) => handleFieldChange("description", e.target.value)}
                    />
                    {errors.description && <p className="text-sm text-red-500">{errors.description}</p>}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {currentStep === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle>Format & Rules</CardTitle>
                  <CardDescription>
                    Define how your tournament will be played
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <label htmlFor="tournamentType" className="text-sm font-medium">
                      Bracket Type
                    </label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {tournamentTypes.map((type) => (
                        <button
                          key={type.value}
                          type="button"
                          onClick={() => handleFieldChange("tournamentType", type.value)}
                          className={`p-4 rounded-lg border-2 text-left transition-all ${
                            formData.tournamentType === type.value
                              ? "border-blue-600 bg-blue-50 dark:bg-blue-950/20"
                              : "border-gray-300 hover:border-gray-400"
                          }`}
                        >
                          <div className="font-medium text-foreground">{type.label}</div>
                          <div className="text-sm text-muted-foreground">{type.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="matchFormat" className="text-sm font-medium">
                      Match Format <span className="text-red-500">*</span>
                    </label>
                    <select
                      id="matchFormat"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={formData.matchFormat}
                      onChange={(e) => handleFieldChange("matchFormat", e.target.value)}
                    >
                      {matchFormats.map((format) => (
                        <option key={format.value} value={format.value}>
                          {format.label}
                        </option>
                      ))}
                    </select>
                    {errors.matchFormat && <p className="text-sm text-red-500">{errors.matchFormat}</p>}
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="rules" className="text-sm font-medium">
                      Tournament Rules <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      id="rules"
                      className="flex min-h-[150px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 placeholder:text-muted-foreground"
                      placeholder="List the rules, restrictions, and guidelines for participants..."
                      value={formData.rules}
                      onChange={(e) => handleFieldChange("rules", e.target.value)}
                    />
                    {errors.rules && <p className="text-sm text-red-500">{errors.rules}</p>}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {currentStep === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle>Entry & Prizes</CardTitle>
                  <CardDescription>
                    Set entry fees and prize distribution
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <label htmlFor="entryFee" className="text-sm font-medium">
                      Entry Fee (USD)
                    </label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="entryFee"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        className="pl-10"
                        value={formData.entryFee || ""}
                        onChange={(e) => handleFieldChange("entryFee", parseFloat(e.target.value) || 0)}
                        error={!!errors.entryFee}
                      />
                    </div>
                    {errors.entryFee && <p className="text-sm text-red-500">{errors.entryFee}</p>}
                    <p className="text-xs text-muted-foreground">Set to 0 for free tournaments</p>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="prizePool" className="text-sm font-medium">
                      Total Prize Pool (USD)
                    </label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="prizePool"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        className="pl-10"
                        value={formData.prizePool || ""}
                        onChange={(e) => handleFieldChange("prizePool", parseFloat(e.target.value) || 0)}
                        error={!!errors.prizePool}
                      />
                    </div>
                    {errors.prizePool && <p className="text-sm text-red-500">{errors.prizePool}</p>}
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="prizeDistribution" className="text-sm font-medium">
                      Prize Distribution
                      {formData.prizePool > 0 && <span className="text-red-500">*</span>}
                    </label>
                    <textarea
                      id="prizeDistribution"
                      className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 placeholder:text-muted-foreground"
                      placeholder="e.g., 1st Place: 50%, 2nd Place: 30%, 3rd Place: 20%"
                      value={formData.prizeDistribution}
                      onChange={(e) => handleFieldChange("prizeDistribution", e.target.value)}
                    />
                    {errors.prizeDistribution && <p className="text-sm text-red-500">{errors.prizeDistribution}</p>}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {currentStep === 4 && (
            <motion.div
              key="step4"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle>Schedule & Registration</CardTitle>
                  <CardDescription>
                    Set dates and participant limits
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <label htmlFor="visibility" className="text-sm font-medium">
                      Tournament Visibility
                    </label>
                    <select
                      id="visibility"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={formData.visibility}
                      onChange={(e) => handleFieldChange("visibility", e.target.value as TournamentVisibility)}
                    >
                      <option value="public">Public - Anyone can see and join</option>
                      <option value="private">Private - Invite only</option>
                      <option value="invite_only">Invite Only - Require approval</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="maxParticipants" className="text-sm font-medium">
                      Maximum Participants <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <Users className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="maxParticipants"
                        type="number"
                        min="2"
                        placeholder="16"
                        className="pl-10"
                        value={formData.maxParticipants || ""}
                        onChange={(e) => handleFieldChange("maxParticipants", parseInt(e.target.value) || 0)}
                        error={!!errors.maxParticipants}
                      />
                    </div>
                    {errors.maxParticipants && <p className="text-sm text-red-500">{errors.maxParticipants}</p>}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label htmlFor="registrationOpenDate" className="text-sm font-medium">
                        Registration Opens <span className="text-red-500">*</span>
                      </label>
                      <Input
                        id="registrationOpenDate"
                        type="datetime-local"
                        value={formData.registrationOpenDate}
                        onChange={(e) => handleFieldChange("registrationOpenDate", e.target.value)}
                        error={!!errors.registrationOpenDate}
                      />
                      {errors.registrationOpenDate && <p className="text-sm text-red-500">{errors.registrationOpenDate}</p>}
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="registrationCloseDate" className="text-sm font-medium">
                        Registration Closes <span className="text-red-500">*</span>
                      </label>
                      <Input
                        id="registrationCloseDate"
                        type="datetime-local"
                        value={formData.registrationCloseDate}
                        onChange={(e) => handleFieldChange("registrationCloseDate", e.target.value)}
                        error={!!errors.registrationCloseDate}
                      />
                      {errors.registrationCloseDate && <p className="text-sm text-red-500">{errors.registrationCloseDate}</p>}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label htmlFor="startDate" className="text-sm font-medium">
                        Tournament Start <span className="text-red-500">*</span>
                      </label>
                      <Input
                        id="startDate"
                        type="datetime-local"
                        value={formData.startDate}
                        onChange={(e) => handleFieldChange("startDate", e.target.value)}
                        error={!!errors.startDate}
                      />
                      {errors.startDate && <p className="text-sm text-red-500">{errors.startDate}</p>}
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="endDate" className="text-sm font-medium">
                        Tournament End (Optional)
                      </label>
                      <Input
                        id="endDate"
                        type="datetime-local"
                        value={formData.endDate}
                        onChange={(e) => handleFieldChange("endDate", e.target.value)}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {currentStep === "preview" && (
            <motion.div
              key="preview"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Eye className="h-5 w-5" />
                    Preview Tournament
                  </CardTitle>
                  <CardDescription>
                    Review all details before publishing
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/40">
                      <Gamepad2 className="h-5 w-5 text-muted-foreground mt-0.5" />
                      <div className="flex-1">
                        <h3 className="font-semibold text-foreground">{formData.name}</h3>
                        <p className="text-sm text-muted-foreground">{formData.gameType}</p>
                        <p className="text-sm mt-2">{formData.description}</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/40">
                      <Trophy className="h-5 w-5 text-muted-foreground mt-0.5" />
                      <div className="flex-1">
                        <h3 className="font-semibold text-foreground">Format</h3>
                        <p className="text-sm text-muted-foreground">
                          {tournamentTypes.find((t) => t.value === formData.tournamentType)?.label} •{" "}
                          {matchFormats.find((f) => f.value === formData.matchFormat)?.label}
                        </p>
                        <p className="text-sm mt-2 whitespace-pre-wrap">{formData.rules}</p>
                      </div>
                    </div>

                    <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/40">
                      <DollarSign className="h-5 w-5 text-muted-foreground mt-0.5" />
                      <div className="flex-1">
                        <h3 className="font-semibold text-foreground">Entry & Prizes</h3>
                        <p className="text-sm text-muted-foreground">
                          Entry: {formData.entryFee === 0 ? "Free" : `$${formData.entryFee.toFixed(2)}`} • Prize Pool: $
                          {formData.prizePool.toFixed(2)}
                        </p>
                        {formData.prizeDistribution && (
                          <p className="text-sm mt-2 whitespace-pre-wrap">{formData.prizeDistribution}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-start gap-4 p-4 rounded-lg bg-muted/40">
                      <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
                      <div className="flex-1">
                        <h3 className="font-semibold text-foreground">Schedule</h3>
                        <p className="text-sm text-muted-foreground">
                          Max Participants: {formData.maxParticipants} • Visibility: {formData.visibility}
                        </p>
                        <div className="text-sm mt-2 space-y-1">
                          <p>Registration: {new Date(formData.registrationOpenDate).toLocaleString()} - {new Date(formData.registrationCloseDate).toLocaleString()}</p>
                          <p>Start: {new Date(formData.startDate).toLocaleString()}</p>
                          {formData.endDate && <p>End: {new Date(formData.endDate).toLocaleString()}</p>}
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {currentStep === "success" && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
            >
              <Card>
                <CardContent className="pt-12 pb-12 text-center">
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-100 dark:bg-green-900 mb-6">
                    <Check className="h-10 w-10 text-green-600 dark:text-green-400" />
                  </div>
                  <h2 className="text-2xl font-bold text-foreground mb-2">
                    Tournament Created!
                  </h2>
                  <p className="text-muted-foreground mb-8">
                    Your tournament "{formData.name}" is now live and ready for participants.
                  </p>

                  <div className="space-y-4 max-w-md mx-auto">
                    <div className="flex gap-2">
                      <Input
                        value={`${window.location.origin}/tournaments/${createdTournamentId}`}
                        readOnly
                        className="flex-1"
                      />
                      <Button onClick={handleCopyLink} variant="outline" size="md">
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="flex gap-3 justify-center">
                      <Button variant="outline" className="flex-1 gap-2">
                        <Twitter className="h-4 w-4" />
                        Share on Twitter
                      </Button>
                      <Button variant="outline" className="flex-1 gap-2">
                        <Facebook className="h-4 w-4" />
                        Share on Facebook
                      </Button>
                    </div>

                    <Button className="w-full gap-2" onClick={() => window.location.href = `/tournaments/${createdTournamentId}`}>
                      <Eye className="h-4 w-4" />
                      View Tournament
                    </Button>

                    <Button variant="ghost" className="w-full" onClick={() => window.location.href = "/tournaments"}>
                      Back to Tournaments
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Navigation Buttons */}
        {currentStep !== "success" && (
          <div className="flex justify-between mt-8">
            <Button
              variant="outline"
              onClick={currentStep === 1 ? () => window.location.href = "/tournaments" : handleBack}
              disabled={currentStep === 1}
            >
              <ChevronLeft className="h-4 w-4 mr-2" />
              {currentStep === 1 ? "Cancel" : "Back"}
            </Button>

            {currentStep === "preview" ? (
              <Button onClick={handleSubmit} disabled={isSubmitting} className="gap-2">
                {isSubmitting ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Publish Tournament
                  </>
                )}
              </Button>
            ) : (
              <Button onClick={handleNext} className="gap-2">
                {currentStep === 4 ? "Preview" : "Next"}
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
