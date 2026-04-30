// filepath: frontend/src/components/ui/MobileErrorBoundary.tsx
"use client";

import { Component, ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { AlertTriangle, RefreshCw, Home, Mail } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// Mobile-specific error messages
const MOBILE_ERROR_MESSAGES = {
  network: {
    title: "Connection Lost",
    message: "Please check your internet connection and try again.",
    action: "Retry",
  },
  timeout: {
    title: "Request Timeout",
    message: "The server took too long to respond. Please try again.",
    action: "Try Again",
  },
  generic: {
    title: "Something Went Wrong",
    message: "An unexpected error occurred. Please try again.",
    action: "Refresh",
  },
  offline: {
    title: "You're Offline",
    message: "Please connect to the internet to continue.",
    action: "Go Back",
  },
};

export class MobileErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Mobile Error Boundary caught:", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleGoHome = () => {
    window.location.href = "/";
  };

  handleReportIssue = () => {
    window.location.href = "/contact?error=true";
  };

  getErrorType = (): keyof typeof MOBILE_ERROR_MESSAGES => {
    const { error } = this.state;
    if (!error) return "generic";

    const message = error.message.toLowerCase();
    if (message.includes("network") || message.includes("fetch")) {
      return "network";
    }
    if (message.includes("timeout") || message.includes("timed out")) {
      return "timeout";
    }
    if (message.includes("offline")) {
      return "offline";
    }
    return "generic";
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const errorType = this.getErrorType();
      const errorInfo = MOBILE_ERROR_MESSAGES[errorType];

      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <div className="w-full max-w-md text-center">
            {/* Error Icon */}
            <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-6">
              <AlertTriangle className="w-8 h-8 text-destructive" />
            </div>

            {/* Error Title */}
            <h1 className="text-xl font-bold text-foreground mb-2">
              {errorInfo.title}
            </h1>

            {/* Error Message */}
            <p className="text-sm text-muted-foreground mb-6">
              {errorInfo.message}
            </p>

            {/* Error Code (for debugging) */}
            {this.state.error && (
              <details className="mb-6 text-left">
                <summary className="text-xs text-muted-foreground cursor-pointer">
                  Technical Details
                </summary>
                <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-x-auto">
                  {this.state.error.message}
                </pre>
              </details>
            )}

            {/* Action Buttons */}
            <div className="space-y-3">
              <Button
                onClick={this.handleRetry}
                className="w-full"
                size="lg"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                {errorInfo.action}
              </Button>

              <div className="flex gap-3">
                <Button
                  onClick={this.handleGoHome}
                  variant="outline"
                  className="flex-1"
                >
                  <Home className="w-4 h-4 mr-2" />
                  Home
                </Button>

                <Button
                  onClick={this.handleReportIssue}
                  variant="ghost"
                  className="flex-1"
                >
                  <Mail className="w-4 h-4 mr-2" />
                  Report
                </Button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Hook for mobile-specific error handling
export function useMobileErrorHandler() {
  const handleError = (error: Error) => {
    console.error("[Mobile Error]:", error);
    
    // Track error for analytics
    if (typeof window !== "undefined" && (window as any).gtag) {
      (window as any).gtag("event", "exception", {
        description: error.message,
        fatal: false,
      });
    }
  };

  return { handleError };
}