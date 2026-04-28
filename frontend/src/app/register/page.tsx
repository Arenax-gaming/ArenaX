"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { ValidationMessage } from "@/components/ui/ValidationMessage";
import { FormValidationSummary } from "@/components/ui/FormValidationSummary";
import { PasswordStrengthIndicator } from "@/components/ui/PasswordStrengthIndicator";
import { useAuth } from "@/hooks/useAuth";
import { useNotifications } from "@/contexts/NotificationContext";
import { registerSchema, type RegisterFormData } from "@/lib/validations/auth";
import { useFormFieldValidation } from "@/hooks/useFormFieldValidation";

export default function RegisterPage() {
  const router = useRouter();
  const { register: registerUser, loading, error, clearError, user } = useAuth();
  const { addToast } = useNotifications();
  const [formData, setFormData] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof RegisterFormData, string>>>({});
  const [showValidationSummary, setShowValidationSummary] = useState(false);

  // Real-time field validation
  const usernameValidation = useFormFieldValidation<RegisterFormData>({
    value: formData.username,
    schema: registerSchema,
    fieldName: "username",
    delay: 400,
  });

  const emailValidation = useFormFieldValidation<RegisterFormData>({
    value: formData.email,
    schema: registerSchema,
    fieldName: "email",
    delay: 400,
  });

  const passwordValidation = useFormFieldValidation<RegisterFormData>({
    value: formData.password,
    schema: registerSchema,
    fieldName: "password",
    delay: 400,
  });

  const confirmPasswordValidation = useFormFieldValidation<RegisterFormData>({
    value: formData.confirmPassword,
    schema: registerSchema,
    fieldName: "confirmPassword",
    delay: 400,
  });

  useEffect(() => {
    if (error) {
      addToast({
        type: "error",
        title: "Registration failed",
        message: error,
        duration: 6000,
      });
      clearError();
    }
  }, [error, addToast, clearError]);

  useEffect(() => {
    if (user) {
      addToast({
        type: "success",
        title: "Account created",
        message: `Welcome, ${user.username}!`,
        duration: 3000,
      });
      router.replace("/");
    }
  }, [user, router, addToast]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.id]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});
    setShowValidationSummary(true);

    const result = registerSchema.safeParse(formData);
    if (!result.success) {
      const errors: Partial<Record<keyof RegisterFormData, string>> = {};
      result.error.issues.forEach((issue) => {
        const path = issue.path[0] as keyof RegisterFormData;
        if (path && !errors[path]) errors[path] = issue.message;
      });
      setFieldErrors(errors);
      return;
    }

    await registerUser({
      username: result.data.username,
      email: result.data.email,
      password: result.data.password,
      confirmPassword: result.data.confirmPassword,
    });
  };

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-4rem)] p-4 sm:p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">
            Create an account
          </CardTitle>
          <CardDescription className="text-center">
            Enter your details below to create your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Validation Summary */}
            <FormValidationSummary
              errors={fieldErrors as Record<string, string>}
              isValid={Object.keys(fieldErrors).length === 0}
              isVisible={showValidationSummary}
            />

            <div className="space-y-2">
              <label
                htmlFor="username"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Username
              </label>
              <Input
                id="username"
                type="text"
                placeholder="ArenaMaster"
                value={formData.username}
                onChange={handleChange}
                disabled={loading}
                error={usernameValidation.isValid === false || !!fieldErrors.username}
                success={usernameValidation.isValid === true}
                autoComplete="username"
                aria-invalid={usernameValidation.isValid === false || !!fieldErrors.username}
                aria-describedby={usernameValidation.error ? "username-error" : usernameValidation.isValid ? "username-success" : undefined}
              />
              <ValidationMessage
                id="username-error"
                message={fieldErrors.username || usernameValidation.error}
                state={
                  fieldErrors.username || usernameValidation.isValid === false
                    ? "error"
                    : usernameValidation.isValid === true
                    ? "success"
                    : "idle"
                }
              />
            </div>
            <div className="space-y-2">
              <label
                htmlFor="email"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="m@example.com"
                value={formData.email}
                onChange={handleChange}
                disabled={loading}
                error={emailValidation.isValid === false || !!fieldErrors.email}
                success={emailValidation.isValid === true}
                autoComplete="email"
                aria-invalid={emailValidation.isValid === false || !!fieldErrors.email}
                aria-describedby={emailValidation.error ? "email-error" : emailValidation.isValid ? "email-success" : undefined}
              />
              <ValidationMessage
                id="email-error"
                message={fieldErrors.email || emailValidation.error}
                state={
                  fieldErrors.email || emailValidation.isValid === false
                    ? "error"
                    : emailValidation.isValid === true
                    ? "success"
                    : "idle"
                }
              />
            </div>
            <div className="space-y-2">
              <label
                htmlFor="password"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Password
              </label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={handleChange}
                disabled={loading}
                error={passwordValidation.isValid === false || !!fieldErrors.password}
                success={passwordValidation.isValid === true}
                autoComplete="new-password"
                aria-invalid={passwordValidation.isValid === false || !!fieldErrors.password}
                aria-describedby={passwordValidation.error ? "password-error" : passwordValidation.isValid ? "password-success" : undefined}
              />
              <ValidationMessage
                id="password-error"
                message={fieldErrors.password || passwordValidation.error}
                state={
                  fieldErrors.password || passwordValidation.isValid === false
                    ? "error"
                    : passwordValidation.isValid === true
                    ? "success"
                    : "idle"
                }
              />
              {/* Password Strength Indicator */}
              {formData.password && (
                <PasswordStrengthIndicator password={formData.password} />
              )}
            </div>
            <div className="space-y-2">
              <label
                htmlFor="confirmPassword"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Confirm Password
              </label>
              <Input
                id="confirmPassword"
                type="password"
                value={formData.confirmPassword}
                onChange={handleChange}
                disabled={loading}
                error={confirmPasswordValidation.isValid === false || !!fieldErrors.confirmPassword}
                success={confirmPasswordValidation.isValid === true}
                autoComplete="new-password"
                aria-invalid={confirmPasswordValidation.isValid === false || !!fieldErrors.confirmPassword}
                aria-describedby={confirmPasswordValidation.error ? "confirmPassword-error" : confirmPasswordValidation.isValid ? "confirmPassword-success" : undefined}
              />
              <ValidationMessage
                id="confirmPassword-error"
                message={fieldErrors.confirmPassword || confirmPasswordValidation.error}
                state={
                  fieldErrors.confirmPassword || confirmPasswordValidation.isValid === false
                    ? "error"
                    : confirmPasswordValidation.isValid === true
                    ? "success"
                    : "idle"
                }
              />
            </div>
            <FormError message={error ?? ""} />
            <Button
              className="w-full"
              type="submit"
              disabled={loading}
              loading={loading}
            >
              Create account
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex justify-center">
          <div className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
