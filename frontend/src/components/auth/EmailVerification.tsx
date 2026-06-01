"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AlertCircle, CheckCircle, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';

interface EmailVerificationProps {
  className?: string;
}

export function EmailVerification({ className }: EmailVerificationProps) {
  const { verifyEmail, resendVerificationEmail, loading, error, clearError, user } = useAuth();
  const router = useRouter();
  const [token, setToken] = useState('');
  const [resending, setResending] = useState(false);
  const [success, setSuccess] = useState(false);

  const pendingEmail = user?.email || (typeof window !== 'undefined' ? localStorage.getItem('arenax_pending_email') || '' : '');

  useEffect(() => {
    clearError();
  }, [clearError]);

  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => {
        router.push('/');
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [success, router]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;

    try {
      await verifyEmail(token.trim());
      setSuccess(true);
    } catch (err) {
      // Error is handled by useAuth
    }
  };

  const handleResend = async () => {
    if (!pendingEmail) return;
    setResending(true);
    try {
      await resendVerificationEmail(pendingEmail);
    } catch (err) {
      // Error is handled by useAuth
    } finally {
      setResending(false);
    }
  };

  if (success) {
    return (
      <div className={cn('text-center py-8', className)}>
        <CheckCircle className="h-16 w-16 text-success mx-auto mb-4" />
        <h2 className="text-xl font-bold text-foreground mb-2">Email verified!</h2>
        <p className="text-muted-foreground mb-6">
          Your email has been successfully verified. Redirecting...
        </p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      <div className="text-center">
        <Mail className="h-12 w-12 text-primary mx-auto mb-4" />
        <p className="text-muted-foreground mb-2">
          We've sent a verification link to your email
        </p>
        {pendingEmail && (
          <p className="text-sm font-medium text-foreground">{pendingEmail}</p>
        )}
      </div>

      <form onSubmit={handleVerify} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor="token" className="block text-sm font-medium text-foreground">
            Verification token
          </label>
          <Input
            id="token"
            type="text"
            placeholder="Enter the verification token from the email"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            error={!!error}
          />
        </div>
        
        {error && (
          <div className="flex gap-2 p-3 rounded-md bg-destructive/5 text-red-800 dark:bg-destructive/10/30 dark:text-red-200">
            <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <p className="text-sm">{error}</p>
          </div>
        )}
        
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          Verify email
        </Button>
      </form>

      <div className="text-center">
        <p className="text-sm text-muted-foreground">
          Didn't receive the email?{' '}
          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            className="text-primary hover:text-info font-medium disabled:opacity-50"
          >
            {resending ? 'Sending...' : 'Resend verification email'}
          </button>
        </p>
      </div>
    </div>
  );
}
