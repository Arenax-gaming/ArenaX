import { cn } from '@/lib/utils';

export type StrengthLevel = 'Weak' | 'Medium' | 'Strong';

/**
 * Scores a password 0–4 based on complexity criteria:
 *   +1  length >= 8
 *   +1  length >= 12
 *   +1  mixed case (upper + lower)
 *   +1  contains a digit
 *   +1  contains a special character
 *
 * Maps to: 0-1 → Weak, 2-3 → Medium, 4-5 → Strong
 */
export function calculateStrength(password: string): StrengthLevel | null {
  if (!password) return null;

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  if (score <= 1) return 'Weak';
  if (score <= 3) return 'Medium';
  return 'Strong';
}

  const getStrengthLabel = () => {
    switch (strength) {
      case 0: return '';
      case 1: return { text: 'Very Weak', color: 'text-destructive' };
      case 2: return { text: 'Weak', color: 'text-orange-500' };
      case 3: return { text: 'Good', color: 'text-yellow-500' };
      case 4: return { text: 'Strong', color: 'text-success' };
      default: return { text: '', color: '' };
    }
  };

  const getBarColors = () => {
    const colors = ['bg-muted', 'bg-muted', 'bg-muted', 'bg-muted'];
    const activeColor = strength === 1 ? 'bg-destructive' : strength === 2 ? 'bg-orange-500' : strength === 3 ? 'bg-yellow-500' : 'bg-success';
    
    for (let i = 0; i < strength && i < colors.length; i++) {
      colors[i] = activeColor;
    }
    return colors;
  };

export function PasswordStrengthIndicator({ password }: PasswordStrengthIndicatorProps) {
  const level = calculateStrength(password);
  if (!level) return null;

  const { bars, color, label } = LEVEL_CONFIG[level];

  return (
    <div className="mt-2" aria-live="polite" aria-atomic="true">
      <div className="flex gap-1 mb-1" role="img" aria-label={`Password strength: ${level}`}>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-300',
              i <= bars ? color : 'bg-gray-200 dark:bg-gray-700'
            )}
          />
        ))}
      </div>
      <p className={cn('text-xs font-medium', label)}>{level}</p>
    </div>
  );
}
