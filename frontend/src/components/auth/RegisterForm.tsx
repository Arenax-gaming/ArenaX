"use client";

import { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { useUsernameAvailability } from '@/hooks/useUsernameAvailability';
import { registerSchema } from '@/lib/validations/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SocialLogin } from './SocialLogin';
import { PasswordStrengthIndicator } from './PasswordStrengthIndicator';
import { cn } from '@/lib/utils';

interface RegisterFormProps {
  className?: string;
}

export function RegisterForm({ className }: RegisterFormProps) {
  const { register, loading, error, clearError, user } = useAuth();
  const router = useRouter();

  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    agreeToTerms: false,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const usernameStatus = useUsernameAvailability(formData.username);

  useEffect(() => {
    if (user) {
      router.push('/auth/verify-email');
    }
  }, [user, router]);

  useEffect(() => {
    clearError();
    setErrors({});
  }, [formData, clearError]);

  const validate = (): boolean => {
    const result = registerSchema.safeParse({
      username: formData.username,
      email: formData.email,
      password: formData.password,
      confirmPassword: formData.confirmPassword,
    });

    const newErrors: Record<string, string> = {};

    if (!result.success) {
      result.error.issues.forEach((issue) => {
        const path = String(issue.path[0]);
        if (path && !newErrors[path]) newErrors[path] = issue.message;
      });
    }

    if (!formData.agreeToTerms) {
      newErrors.agreeToTerms = 'You must agree to the terms';
    }

    if (usernameStatus === 'unavailable') {
      newErrors.username = 'This username is already taken';
    } else if (usernameStatus === 'checking') {
      newErrors.username = 'Please wait while we check username availability';
    } else if (usernameStatus === 'error') {
      newErrors.username = 'Could not verify username availability. Please try again.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    await register({
      username: formData.username,
      email: formData.email,
      password: formData.password,
      confirmPassword: formData.confirmPassword,
    });

    if (!error) {
      router.push('/auth/verify-email');
    }
  };

  const isSubmitDisabled =
    loading ||
    usernameStatus === 'checking' ||
    usernameStatus === 'unavailable';

  return (
    <div className={cn('space-y-6', className)}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Username */}
        <div className="space-y-1">
          <label htmlFor="username" className="block text-sm font-medium text-foreground">
            Username
          </label>
          <div className="relative">
            <Input
              id="username"
              type="text"
              autoComplete="username"
              placeholder="yourusername"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              error={!!errors.username || usernameStatus === 'unavailable'}
              aria-describedby="rf-username-hint rf-username-status"
              aria-invalid={!!errors.username || usernameStatus === 'unavailable'}
              className="pr-8"
            />
            {usernameStatus === 'checking' && (
              <Loader2
                className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground"
                aria-hidden="true"
              />
            )}
            {usernameStatus === 'available' && (
              <CheckCircle2
                className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500"
                aria-hidden="true"
              />
            )}
            {usernameStatus === 'unavailable' && (
              <XCircle
                className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-destructive"
                aria-hidden="true"
              />
            )}
          </div>
          <p id="rf-username-hint" className="text-xs text-muted-foreground">
            3–20 characters, letters and numbers only
          </p>
          <p
            id="rf-username-status"
            aria-live="polite"
            className={
              usernameStatus === 'available'
                ? 'text-xs text-green-500'
                : usernameStatus === 'unavailable' || usernameStatus === 'error'
                ? 'text-xs text-destructive'
                : 'sr-only'
            }
          >
            {usernameStatus === 'available' && 'Username is available'}
            {usernameStatus === 'unavailable' && 'Username is already taken'}
            {usernameStatus === 'error' && 'Could not check availability'}
            {usernameStatus === 'checking' && 'Checking availability…'}
          </p>
          {errors.username && (
            <p id="username-error" className="flex items-center gap-1 text-xs text-destructive">
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              {errors.username}
            </p>
          )}
        </div>

        {/* Email */}
        <div className="space-y-1">
          <label htmlFor="register-email" className="block text-sm font-medium text-foreground">
            Email address
          </label>
          <Input
            id="register-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            error={!!errors.email || !!error}
            aria-describedby={errors.email ? 'rf-email-error' : undefined}
            aria-invalid={!!errors.email || !!error}
          />
          {errors.email && (
            <p id="register-email-error" className="flex items-center gap-1 text-xs text-destructive">
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              {errors.email}
            </p>
          )}
        </div>

        {/* Password */}
        <div className="space-y-1">
          <label htmlFor="register-password" className="block text-sm font-medium text-foreground">
            Password
          </label>
          <Input
            id="register-password"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            error={!!errors.password}
            aria-describedby={errors.password ? 'rf-password-error' : undefined}
            aria-invalid={!!errors.password}
          />
          <PasswordStrengthIndicator password={formData.password} />
          {errors.password && (
            <p id="register-password-error" className="flex items-center gap-1 text-xs text-destructive">
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              {errors.password}
            </p>
          )}
        </div>

        {/* Confirm Password */}
        <div className="space-y-1">
          <label htmlFor="confirm-password" className="block text-sm font-medium text-foreground">
            Confirm password
          </label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            value={formData.confirmPassword}
            onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
            error={!!errors.confirmPassword}
            aria-describedby={errors.confirmPassword ? 'rf-confirm-error' : undefined}
            aria-invalid={!!errors.confirmPassword}
          />
          {errors.confirmPassword && (
            <p id="confirm-password-error" className="flex items-center gap-1 text-xs text-destructive">
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              {errors.confirmPassword}
            </p>
          )}
        </div>

        {error && (
          <div className="flex gap-2 p-3 rounded-md bg-destructive/5 text-red-800 dark:bg-destructive/10/30 dark:text-red-200">
            <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Terms */}
        <div className="flex items-start">
          <div className="flex items-center h-5">
            <input
              id="agree-terms"
              type="checkbox"
              checked={formData.agreeToTerms}
              onChange={(e) => setFormData({ ...formData, agreeToTerms: e.target.checked })}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
            />
          </div>
          <div className="ml-2 text-sm">
            <label htmlFor="agree-terms" className="text-muted-foreground">
              I agree to the{' '}
              <a href="/terms" className="text-primary hover:text-info font-medium">
                Terms of Service
              </a>{' '}
              and{' '}
              <a href="/privacy" className="text-primary hover:text-info font-medium">
                Privacy Policy
              </a>
            </label>
            {errors.agreeToTerms && (
              <p className="flex items-center gap-1 mt-1 text-xs text-destructive">
                <AlertCircle className="h-3 w-3" />
                {errors.agreeToTerms}
              </p>
            )}
          </div>
        </div>

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

      <SocialLogin />
    </div>
  );
}
