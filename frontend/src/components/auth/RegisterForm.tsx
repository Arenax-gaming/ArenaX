"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, XCircle, Loader2, AlertCircle } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import { useUsernameAvailability } from "@/hooks/useUsernameAvailability";
import { registerSchema, type RegisterFormData } from "@/lib/validations/auth";
import { AuthApiError, REGISTER_ERROR_MAP } from "@/lib/authErrors";
import { useFormAnalytics } from "@/hooks/useFormAnalytics";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import { SocialLogin } from "./SocialLogin";
import { PasswordStrengthIndicator } from "./PasswordStrengthIndicator";

interface RegisterFormProps {
  className?: string;
}

export function RegisterForm({ className }: RegisterFormProps) {
  const { register, loading, error, clearError, user } = useAuth();
  const router = useRouter();
  const analytics = useFormAnalytics("register");

  const form = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      username: "",
      email: "",
      password: "",
      confirmPassword: "",
      agreeToTerms: false,
    },
    mode: "onTouched", // validate on blur, then on change
  });

  const watchedUsername = form.watch("username");
  const watchedPassword = form.watch("password");
  const usernameStatus = useUsernameAvailability(watchedUsername);

  // Redirect after successful registration
  useEffect(() => {
    if (user) router.push("/auth/verify-email");
  }, [user, router]);

  // Clear auth context error on change
  useEffect(() => {
    const subscription = form.watch(() => clearError());
    return () => subscription.unsubscribe();
  }, [form, clearError]);

  // Surface async username availability into RHF errors
  useEffect(() => {
    if (usernameStatus === "unavailable") {
      form.setError("username", { message: "This username is already taken" });
    } else if (usernameStatus === "error") {
      form.setError("username", {
        message: "Could not verify username availability. Please try again.",
      });
    } else if (usernameStatus === "available") {
      // Only clear the async error, not schema errors
      if (
        form.formState.errors.username?.message === "This username is already taken" ||
        form.formState.errors.username?.message?.includes("verify")
      ) {
        form.clearErrors("username");
      }
    }
  }, [usernameStatus, form]);

  const onSubmit = async (data: RegisterFormData) => {
    try {
      await register({
        username: data.username,
        email: data.email,
        password: data.password,
        confirmPassword: data.confirmPassword,
      });
      analytics.trackSubmit({ success: true });
      router.push("/auth/verify-email");
    } catch (err) {
      analytics.trackSubmit({ success: false });
      if (err instanceof AuthApiError) {
        const mapped = REGISTER_ERROR_MAP[err.code];
        if (mapped) {
          form.setError(mapped.field as keyof RegisterFormData, {
            message: mapped.message,
          });
          return;
        }
      }
    }
  };

  const isSubmitDisabled =
    loading ||
    usernameStatus === "checking" ||
    usernameStatus === "unavailable";

  return (
    <div className={cn("space-y-6", className)}>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
        >
          {/* Username */}
          <FormField
            control={form.control}
            name="username"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Username</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Input
                      {...field}
                      type="text"
                      autoComplete="username"
                      placeholder="yourusername"
                      error={
                        !!form.formState.errors.username ||
                        usernameStatus === "unavailable"
                      }
                      className="pr-8"
                    />
                    {usernameStatus === "checking" && (
                      <Loader2
                        className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                    {usernameStatus === "available" && !form.formState.errors.username && (
                      <CheckCircle2
                        className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500"
                        aria-hidden="true"
                      />
                    )}
                    {usernameStatus === "unavailable" && (
                      <XCircle
                        className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-destructive"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                </FormControl>
                <FormDescription>
                  3–20 characters, letters and numbers only
                </FormDescription>
                {/* Accessibility live region for async status */}
                <p
                  aria-live="polite"
                  className={
                    usernameStatus === "available"
                      ? "text-xs text-green-500"
                      : usernameStatus === "unavailable" || usernameStatus === "error"
                      ? "text-xs text-destructive"
                      : "sr-only"
                  }
                >
                  {usernameStatus === "available" && "Username is available"}
                  {usernameStatus === "unavailable" && "Username is already taken"}
                  {usernameStatus === "error" && "Could not check availability"}
                  {usernameStatus === "checking" && "Checking availability…"}
                </p>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Email */}
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email address</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    error={!!form.formState.errors.email || !!error}
                  />
                </FormControl>
                <FormMessage>
                  {form.formState.errors.email?.message ===
                    REGISTER_ERROR_MAP.EMAIL_ALREADY_EXISTS?.message && (
                    <>
                      {" "}
                      <Link
                        href="/auth/login"
                        className="underline underline-offset-2 hover:text-destructive/80 font-medium"
                      >
                        Log in instead
                      </Link>
                    </>
                  )}
                </FormMessage>
              </FormItem>
            )}
          />

          {/* Password */}
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    error={!!form.formState.errors.password}
                  />
                </FormControl>
                <PasswordStrengthIndicator password={watchedPassword} />
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Confirm Password */}
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Confirm password</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    error={!!form.formState.errors.confirmPassword}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Auth context error banner */}
          {error && (
            <div
              role="alert"
              className="flex gap-2 p-3 rounded-md bg-destructive/5 text-red-800 dark:bg-destructive/10 dark:text-red-200"
            >
              <AlertCircle
                className="h-5 w-5 flex-shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <p className="text-sm">{error}</p>
            </div>
          )}

          {/* Terms */}
          <FormField
            control={form.control}
            name="agreeToTerms"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-start gap-2">
                  <FormControl>
                    <input
                      type="checkbox"
                      id="agree-terms"
                      checked={field.value}
                      onChange={field.onChange}
                      className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    />
                  </FormControl>
                  <label
                    htmlFor="agree-terms"
                    className="text-sm text-muted-foreground cursor-pointer"
                  >
                    I agree to the{" "}
                    <a
                      href="/terms"
                      className="text-primary hover:text-info font-medium"
                    >
                      Terms of Service
                    </a>{" "}
                    and{" "}
                    <a
                      href="/privacy"
                      className="text-primary hover:text-info font-medium"
                    >
                      Privacy Policy
                    </a>
                  </label>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={loading}
            disabled={isSubmitDisabled}
          >
            Create account
          </Button>
        </form>
      </Form>

      <SocialLogin />
    </div>
  );
}
