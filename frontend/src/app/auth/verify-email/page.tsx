import { AuthLayout } from '@/components/auth/AuthLayout';
import { EmailVerification } from '@/components/auth/EmailVerification';

export default function VerifyEmailPage() {
  return (
    <AuthLayout
      title="Verify your email"
      subtitle="Enter the code we sent to your email"
      type="verify-email"
    >
      <EmailVerification />
    </AuthLayout>
  );
}
