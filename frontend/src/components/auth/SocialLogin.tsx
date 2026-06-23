import { Button } from '@/components/ui/Button';

interface SocialLoginProps {
  className?: string;
}

export function SocialLogin({ className }: SocialLoginProps) {
  const handleSocialLogin = (provider: string) => {
    console.log(`Logging in with ${provider}`);
    // In a real app, redirect to auth provider or call API
  };

  return (
    <div className={className}>
      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
        </div>
      </div>
      
      <div className="grid grid-cols-3 gap-3">
        <Button
          variant="outline"
          type="button"
          className="flex items-center justify-center gap-2"
          onClick={() => handleSocialLogin('Google')}
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
        </Button>
        
        <Button
          variant="outline"
          type="button"
          className="flex items-center justify-center gap-2"
          onClick={() => handleSocialLogin('Discord')}
        >
          <svg className="h-5 w-5 text-indigo-500" viewBox="0 0 24 24" fill="currentColor">
            <path d="M14.82 4.26a10.14 10.14 0 0 0-.53 1.1 14.66 14.66 0 0 0-4.58 0 9.76 9.76 0 0 0-.51-1.1A10.37 10.37 0 0 0 6 8.5a14.5 14.5 0 0 0-1.35 4.47 14.08 14.08 0 0 0 .1 3.07 10.76 10.76 0 0 0 3.6 5.27A11.4 11.4 0 0 0 9.24 19a7.7 7.7 0 0 0 .9-1.44 8.36 8.36 0 0 1-2.22-.85 3.19 3.19 0 0 1-1.14-1.54c.25-.18.48-.38.7-.57a3.61 3.61 0 0 1 1.92 2.27 9.24 9.24 0 0 0 2.18.53 8.24 8.24 0 0 0 2.18-.53 3.56 3.56 0 0 1 1.91-2.27c.22.19.45.39.7.57a3.14 3.14 0 0 1-1.13 1.54 8.14 8.14 0 0 1-2.22.85c.25.5.56 1 .9 1.44a10.66 10.66 0 0 0 4.78-.23 10.32 10.32 0 0 0 3.6-5.27 12.08 12.08 0 0 0 .1-3.07A14.08 14.08 0 0 0 18 8.5a10.3 10.3 0 0 0-3.18-4.24zM8.13 13.82a1.94 1.94 0 0 1-1.8-2 1.93 1.93 0 0 1 1.8-2 1.93 1.93 0 0 1 1.8 2 1.93 1.93 0 0 1-1.8 2zm7.74 0a1.94 1.94 0 0 1-1.8-2 1.93 1.93 0 0 1 1.8-2 1.93 1.93 0 0 1 1.8 2 1.93 1.93 0 0 1-1.8 2z" />
          </svg>
        </Button>
        
        <Button
          variant="outline"
          type="button"
          className="flex items-center justify-center gap-2"
          onClick={() => handleSocialLogin('Twitch')}
        >
          <svg className="h-5 w-5 text-purple-600" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
          </svg>
        </Button>
      </div>
    </div>
  );
}
