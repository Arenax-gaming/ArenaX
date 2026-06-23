import { AuthLayout } from '@/components/auth/AuthLayout';
import { PasswordResetForm } from '@/components/auth/PasswordResetForm';

export default function ForgotPasswordPage() {
  return (
    <AuthLayout
      title="Reset password"
      subtitle="Enter your email to receive a reset link"
      type="forgot-password"
    >
      <PasswordResetForm />
    </AuthLayout>
  );
}
