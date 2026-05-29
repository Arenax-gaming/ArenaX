"use client";

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SocialLogin } from './SocialLogin';
import { PasswordStrengthIndicator } from './PasswordStrengthIndicator';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RegisterFormProps {
  className?: string;
}

export function RegisterForm({ className }: RegisterFormProps) {
  const { register, loading, error, clearError } = useAuth();
  const router = useRouter();
  
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    agreeToTerms: false,
  });
  
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    clearError();
    setErrors({});
  }, [formData, clearError]);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    
    if (!formData.username.trim()) {
      newErrors.username = 'Username is required';
    } else if (formData.username.length < 3) {
      newErrors.username = 'Username must be at least 3 characters';
    }
    
    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Invalid email address';
    }
    
    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    }
    
    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }
    
    if (!formData.agreeToTerms) {
      newErrors.agreeToTerms = 'You must agree to the terms';
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

  return (
    <div className={cn('space-y-6', className)}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="username" className="block text-sm font-medium text-foreground">
            Username
          </label>
          <Input
            id="username"
            type="text"
            autoComplete="username"
            placeholder="yourusername"
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
            error={!!errors.username}
          />
          {errors.username && (
            <p className="flex items-center gap-1 text-xs text-red-500">
              <AlertCircle className="h-3 w-3" />
              {errors.username}
            </p>
          )}
        </div>
        
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
          />
          {errors.email && (
            <p className="flex items-center gap-1 text-xs text-red-500">
              <AlertCircle className="h-3 w-3" />
              {errors.email}
            </p>
          )}
        </div>
        
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
          />
          <PasswordStrengthIndicator password={formData.password} />
          {errors.password && (
            <p className="flex items-center gap-1 text-xs text-red-500">
              <AlertCircle className="h-3 w-3" />
              {errors.password}
            </p>
          )}
        </div>
        
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
          />
          {errors.confirmPassword && (
            <p className="flex items-center gap-1 text-xs text-red-500">
              <AlertCircle className="h-3 w-3" />
              {errors.confirmPassword}
            </p>
          )}
        </div>
        
        {error && (
          <div className="flex gap-2 p-3 rounded-md bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-200">
            <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <p className="text-sm">{error}</p>
          </div>
        )}
        
        <div className="flex items-start">
          <div className="flex items-center h-5">
            <input
              id="agree-terms"
              type="checkbox"
              checked={formData.agreeToTerms}
              onChange={(e) => setFormData({ ...formData, agreeToTerms: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
          </div>
          <div className="ml-2 text-sm">
            <label htmlFor="agree-terms" className="text-muted-foreground">
              I agree to the{' '}
              <a href="/terms" className="text-blue-600 hover:text-blue-700 font-medium">
                Terms of Service
              </a>{' '}
              and{' '}
              <a href="/privacy" className="text-blue-600 hover:text-blue-700 font-medium">
                Privacy Policy
              </a>
            </label>
            {errors.agreeToTerms && (
              <p className="flex items-center gap-1 mt-1 text-xs text-red-500">
                <AlertCircle className="h-3 w-3" />
                {errors.agreeToTerms}
              </p>
            )}
          </div>
        </div>
        
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          Create account
        </Button>
      </form>
      
      <SocialLogin />
    </div>
  );
}
