import { cn } from '@/lib/utils';

interface PasswordStrengthIndicatorProps {
  password: string;
}

type StrengthLevel = 0 | 1 | 2 | 3 | 4;

export function PasswordStrengthIndicator({ password }: PasswordStrengthIndicatorProps) {
  const calculateStrength = (pw: string): StrengthLevel => {
    let strength = 0;
    if (pw.length >= 8) strength++;
    if (pw.length >= 12) strength++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) strength++;
    if (/[0-9]/.test(pw)) strength++;
    if (/[^a-zA-Z0-9]/.test(pw)) strength++;
    return strength as StrengthLevel;
  };

  const strength = calculateStrength(password);

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

  const label = getStrengthLabel();
  const barColors = getBarColors();

  if (!password) return null;

  return (
    <div className="mt-2">
      <div className="flex gap-1 mb-1">
        {barColors.map((color, index) => (
          <div
            key={index}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-300',
              color
            )}
          />
        ))}
      </div>
      {label.text && (
        <p className={cn('text-xs font-medium', label.color)}>
          {label.text}
        </p>
      )}
    </div>
  );
}
