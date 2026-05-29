import Link from 'next/link';
import Image from 'next/image';

interface AuthLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  type?: 'login' | 'register' | 'forgot-password' | 'verify-email';
}

export function AuthLayout({ children, title, subtitle, type }: AuthLayoutProps) {
  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Left Section - Image/Branding */}
      <div className="hidden md:flex md:w-1/2 bg-gradient-to-br from-blue-600 to-purple-700 items-center justify-center p-8 text-white">
        <div className="max-w-md">
          <div className="mb-6 flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center">
              <span className="text-2xl font-bold">AX</span>
            </div>
            <span className="text-2xl font-bold">ArenaX</span>
          </div>
          <h1 className="text-3xl font-bold mb-4">Competitive Gaming Platform</h1>
          <p className="text-blue-100 text-lg">
            Join tournaments, compete for prizes, and climb the leaderboard
          </p>
        </div>
      </div>

      {/* Right Section - Form */}
      <div className="flex-1 flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-md">
          <div className="md:hidden mb-8 flex items-center justify-center gap-2">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-600 to-purple-700 flex items-center justify-center text-white font-bold">
              AX
            </div>
            <span className="text-xl font-bold text-foreground">ArenaX</span>
          </div>

          {title && (
            <div className="mb-8 text-center md:text-left">
              <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-2">{title}</h1>
              {subtitle && (
                <p className="text-muted-foreground">{subtitle}</p>
              )}
            </div>
          )}

          <div className="bg-card rounded-xl border p-6 md:p-8 shadow-sm">
            {children}
          </div>

          <div className="mt-8 text-center text-sm text-muted-foreground">
            {type === 'login' ? (
              <>
                Don&apos;t have an account?{' '}
                <Link href="/auth/register" className="text-blue-600 hover:text-blue-700 font-medium">
                  Sign up
                </Link>
              </>
            ) : type === 'register' ? (
              <>
                Already have an account?{' '}
                <Link href="/auth/login" className="text-blue-600 hover:text-blue-700 font-medium">
                  Sign in
                </Link>
              </>
            ) : type === 'forgot-password' ? (
              <>
                Remember your password?{' '}
                <Link href="/auth/login" className="text-blue-600 hover:text-blue-700 font-medium">
                  Sign in
                </Link>
              </>
            ) : (
              <Link href="/auth/login" className="text-blue-600 hover:text-blue-700 font-medium">
                Return to login
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
