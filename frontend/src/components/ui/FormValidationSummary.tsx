import { AlertTriangle, CheckCircle } from "lucide-react";

interface FormValidationSummaryProps {
  errors: Record<string, string>;
  isValid: boolean;
  isVisible: boolean;
}

export function FormValidationSummary({
  errors,
  isValid,
  isVisible,
}: FormValidationSummaryProps) {
  if (!isVisible || Object.keys(errors).length === 0) return null;

  const errorList = Object.entries(errors);

  return (
    <div
      className={`rounded-lg border p-4 transition-all duration-300 ${
        isValid
          ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20"
          : "border-destructive/20 bg-destructive/5"
      }`}
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        {isValid ? (
          <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
        ) : (
          <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" aria-hidden="true" />
        )}
        <div className="flex-1">
          <h3
            className={`text-sm font-semibold ${
              isValid ? "text-green-800 dark:text-green-200" : "text-destructive"
            }`}
          >
            {isValid ? "Form Ready" : "Please fix the following errors"}
          </h3>
          {!isValid && errorList.length > 0 && (
            <ul className="mt-2 space-y-1.5" aria-label="Form validation errors">
              {errorList.map(([field, message]) => (
                <li key={field} className="text-sm text-destructive flex items-start gap-2">
                  <span className="mt-1 h-1 w-1 rounded-full bg-destructive flex-shrink-0" />
                  <span>
                    <span className="font-medium capitalize">{field}:</span> {message}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
