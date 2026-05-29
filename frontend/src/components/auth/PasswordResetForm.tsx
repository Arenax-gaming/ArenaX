"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AlertCircle, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PasswordResetFormProps {
  className?: string;
}

export function PasswordResetForm({ className }: PasswordResetFormProps) {
  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1500));
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reset email');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1500));
      setStep('request');
      setSuccess(true);
      setEmail('');
      setPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'request' && success) {
    return (
      <div className={cn('text-center py-8', className)}>
        <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-foreground mb-2">Check your email</h2>
        <p className="text-muted-foreground mb-6">
          We&apos;ve sent a password reset link to <span className="font-medium">{email}</span>
        </p>
        <p className="text-sm text-muted-foreground">
          Didn&apos;t receive the email? Check your spam folder or{' '}
          <button
            onClick={() => setSuccess(false)}
            className="text-blue-600 hover:text-blue-700 font-medium"
          >
            try again
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className={className}>
      {step === 'request' ? (
        <form onSubmit={handleRequestReset} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="reset-email" className="block text-sm font-medium text-foreground">
              Email address
            </label>
            <Input
              id="reset-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={!!error}
            />
            {error && (
              <p className="flex items-center gap-1 text-xs text-red-500">
                <AlertCircle className="h-3 w-3" />
                {error}
              </p>
            )}
          </div>
          
          <Button type="submit" size="lg" className="w-full" loading={loading}>
            Send reset link
          </Button>
        </form>
      ) : (
        <form onSubmit={handleResetPassword} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="new-password" className="block text-sm font-medium text-foreground">
              New password
            </label>
            <Input
              id="new-password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={!!error}
            />
          </div>
          
          <div className="space-y-1">
            <label htmlFor="confirm-new-password" className="block text-sm font-medium text-foreground">
              Confirm new password
            </label>
            <Input
              id="confirm-new-password"
              type="password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              error={!!error}
            />
            {error && (
              <p className="flex items-center gap-1 text-xs text-red-500">
                <AlertCircle className="h-3 w-3" />
                {error}
              </p>
            )}
          </div>
          
          <Button type="submit" size="lg" className="w-full" loading={loading}>
            Reset password
          </Button>
        </form>
      )}
    </div>
  );
}
