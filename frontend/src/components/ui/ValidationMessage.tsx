import { CheckCircle2, XCircle, AlertCircle } from "lucide-react";

interface ValidationMessageProps {
  message: string | null;
  state: "error" | "success" | "idle";
  id?: string;
}

export function ValidationMessage({
  message,
  state,
  id,
}: ValidationMessageProps) {
  if (!message && state === "idle") return null;

  const getIcon = () => {
    switch (state) {
      case "error":
        return <XCircle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />;
      case "success":
        return <CheckCircle2 className="h-4 w-4 flex-shrink-0" aria-hidden="true" />;
      default:
        return <AlertCircle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />;
    }
  };

  const getColor = () => {
    switch (state) {
      case "error":
        return "text-destructive";
      case "success":
        return "text-green-600";
      default:
        return "text-muted-foreground";
    }
  };

  return (
    <div
      id={id}
      className={`flex items-start gap-2 text-sm ${getColor()}`}
      role={state === "error" ? "alert" : "status"}
      aria-live={state === "error" ? "assertive" : "polite"}
    >
      {getIcon()}
      <span className="flex-1">{message}</span>
    </div>
  );
}
