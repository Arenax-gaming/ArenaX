import { AuthLayout } from '@/components/auth/AuthLayout';
import { RegisterForm } from '@/components/auth/RegisterForm';

export default function RegisterPage() {
  return (
    <AuthLayout
      title="Create account"
      subtitle="Join ArenaX and start competing"
      type="register"
    >
      <RegisterForm />
    </AuthLayout>
  );
}
