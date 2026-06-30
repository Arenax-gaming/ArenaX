"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { loginSchema, type LoginFormData } from "@/lib/validations/auth";
import { useFormAnalytics } from "@/hooks/useFormAnalytics";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";
import { SocialLogin } from "./SocialLogin";

interface LoginFormProps {
  className?: string;
}

export function LoginForm({ className }: LoginFormProps) {
  const { login, loading, error, clearError } = useAuth();
  const router = useRouter();
  const analytics = useFormAnalytics("login");

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
      rememberMe: false,
    },
  });

  // Clear auth context error when user edits the form
  useEffect(() => {
    const subscription = form.watch(() => clearError());
    return () => subscription.unsubscribe();
  }, [form, clearError]);

  // Track form start on first interaction
  useEffect(() => {
    const subscription = form.watch((_values, { type }) => {
      if (type === "change") analytics.trackStart();
      // Unsubscribe after first change to avoid repeated starts
      subscription.unsubscribe();
    });
    return () => subscription.unsubscribe();
  }, [form, analytics]);

  const onSubmit = async (data: LoginFormData) => {
    await login({ email: data.email, password: data.password, rememberMe: data.rememberMe });

    if (!error) {
      analytics.trackSubmit({ success: true });
      router.push("/");
    } else {
      analytics.trackSubmit({ success: false });
    }
  };

  const handleGuestSession = () => {
    router.push("/");
  };

  return (
    <div className={cn("space-y-6", className)}>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
        >
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
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Password */}
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between">
                  <FormLabel>Password</FormLabel>
                  <Link
                    href="/auth/forgot-password"
                    className="text-sm text-primary hover:text-info font-medium"
                  >
                    Forgot password?
                  </Link>
                </div>
                <FormControl>
                  <Input
                    {...field}
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    error={!!form.formState.errors.password || !!error}
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
              <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-sm">{error}</p>
            </div>
          )}

          {/* Remember me */}
          <FormField
            control={form.control}
            name="rememberMe"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2 space-y-0">
                <FormControl>
                  <input
                    type="checkbox"
                    id="remember-me"
                    checked={field.value}
                    onChange={field.onChange}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                </FormControl>
                <FormLabel htmlFor="remember-me" className="text-sm text-muted-foreground font-normal cursor-pointer">
                  Remember me
                </FormLabel>
              </FormItem>
            )}
          />

          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={loading}
            disabled={loading}
          >
            Sign in
          </Button>
        </form>
      </Form>

      <SocialLogin />

      <div className="text-center">
        <button
          type="button"
          onClick={handleGuestSession}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Continue as guest
        </button>
      </div>
    </div>
  );
}
