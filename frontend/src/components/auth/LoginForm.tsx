"use client";

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SocialLogin } from './SocialLogin';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LoginFormProps {
  className?: string;
}

export function LoginForm({ className }: LoginFormProps) {
  const { login, loading, error, clearError } = useAuth();
  const router = useRouter();
  
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    rememberMe: false,
  });
  
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Clear errors when form changes
  useEffect(() => {
    clearError();
    setErrors({});
  }, [formData, clearError]);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    
    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Invalid email address';
    }
    
    if (!formData.password) {
      newErrors.password = 'Password is required';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validate()) return;
    
    await login({
      email: formData.email,
      password: formData.password,
      rememberMe: formData.rememberMe,
    });
    
    if (!error) {
      router.push('/');
    }
  };

  const handleGuestSession = () => {
    console.log('Continuing as guest');
    router.push('/');
  };

  return (
    <div className={cn('space-y-6', className)}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="email" className="block text-sm font-medium text-foreground">
            Email address
          </label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            error={!!errors.email || !!error}
            aria-describedby={errors.email ? "email-error" : undefined}
            aria-invalid={!!errors.email || !!error}
          />
          {errors.email && (
            <p id="email-error" className="flex items-center gap-1 text-xs text-red-500">
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              {errors.email}
            </p>
          )}
        </div>
        
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="block text-sm font-medium text-foreground">
              Password
            </label>
            <Link href="/auth/forgot-password" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            error={!!errors.password || !!error}
            aria-describedby={errors.password ? "password-error" : undefined}
            aria-invalid={!!errors.password || !!error}
          />
          {errors.password && (
            <p id="password-error" className="flex items-center gap-1 text-xs text-red-500">
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              {errors.password}
            </p>
          )}
        </div>
        
        {error && (
          <div className="flex gap-2 p-3 rounded-md bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-200">
            <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <p className="text-sm">{error}</p>
          </div>
        )}
        
        <div className="flex items-center">
          <input
            id="remember-me"
            type="checkbox"
            checked={formData.rememberMe}
            onChange={(e) => setFormData({ ...formData, rememberMe: e.target.checked })}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="remember-me" className="ml-2 block text-sm text-muted-foreground">
            Remember me
          </label>
        </div>
        
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          Sign in
        </Button>
      </form>
      
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
