"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AlertCircle, CheckCircle, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmailVerificationProps {
  className?: string;
}

export function EmailVerification({ className }: EmailVerificationProps) {
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleInputChange = (index: number, value: string) => {
    if (value.length > 1) {
      value = value.slice(-1);
    }
    
    const newCode = [...code];
    newCode[index] = value;
    setCode(newCode);
    
    if (value && index < 5) {
      const nextInput = document.getElementById(`code-${index + 1}`);
      nextInput?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      const prevInput = document.getElementById(`code-${index - 1}`);
      prevInput?.focus();
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1500));
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setError(null);
    
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1500));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend code');
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
          Your email has been successfully verified.
        </p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      <div className="text-center">
        <Mail className="h-12 w-12 text-primary mx-auto mb-4" />
        <p className="text-muted-foreground mb-2">
          We&apos;ve sent a verification code to your email
        </p>
      </div>

      <form onSubmit={handleVerify} className="space-y-6">
        <div className="flex justify-center gap-2">
          {code.map((digit, index) => (
            <Input
              key={index}
              id={`code-${index}`}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleInputChange(index, e.target.value)}
              onKeyDown={(e) => handleKeyDown(index, e)}
              className="w-12 h-14 text-center text-lg font-bold"
              error={!!error}
            />
          ))}
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
          Didn&apos;t receive the code?{' '}
          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            className="text-primary hover:text-info font-medium disabled:opacity-50"
          >
            {resending ? 'Sending...' : 'Resend code'}
          </button>
        </p>
      </div>
    </div>
  );
}
