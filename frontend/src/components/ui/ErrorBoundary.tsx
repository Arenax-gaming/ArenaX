"use client";

import { Component, ReactNode } from "react";
import { Button } from "./Button";
import { AlertTriangle, RefreshCw, Home, Mail, Copy, Check } from "lucide-react";
import { logError } from "@/lib/errorLogger";
import { ErrorCategory } from "@/lib/errors";
import { useState } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  copied: boolean;
}

// Error messages by category
const ERROR_MESSAGES = {
  [ErrorCategory.NETWORK]: {
    title: "Connection Lost",
    message: "Please check your internet connection and try again.",
    action: "Retry",
  },
  [ErrorCategory.AUTHENTICATION]: {
    title: "Authentication Error",
    message: "Please log in again to continue.",
    action: "Go to Login",
  },
  [ErrorCategory.VALIDATION]: {
    title: "Invalid Input",
    message: "Please check your inputs and try again.",
    action: "Try Again",
  },
  [ErrorCategory.API]: {
    title: "Server Error",
    message: "Our servers are having issues. Please try again later.",
    action: "Retry",
  },
  [ErrorCategory.RUNTIME]: {
    title: "Something Went Wrong",
    message: "An unexpected error occurred. Please try again.",
    action: "Refresh",
  },
  [ErrorCategory.UNKNOWN]: {
    title: "Something Went Wrong",
    message: "An unexpected error occurred. Please try again.",
    action: "Refresh",
  },
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, copied: false };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });
    logError(error, { componentStack: errorInfo.componentStack });
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleGoHome = () => {
    window.location.href = "/";
  };

  handleGoToLogin = () => {
    window.location.href = "/login";
  };

  handleReportIssue = () => {
    window.location.href = "/contact?error=true";
  };

  handleCopyErrorDetails = () => {
    const { error, errorInfo } = this.state;
    const details = `Error: ${error?.message}\nStack: ${error?.stack}\nComponent Stack: ${errorInfo?.componentStack}`;
    navigator.clipboard.writeText(details).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    });
  };

  getErrorCategory = (): ErrorCategory => {
    const { error } = this.state;
    if (!error) return ErrorCategory.UNKNOWN;
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (message.includes("network") || message.includes("fetch") || message.includes("timeout")) {
        return ErrorCategory.NETWORK;
      }
      if (message.includes("unauthorized") || message.includes("forbidden") || message.includes("authentication")) {
        return ErrorCategory.AUTHENTICATION;
      }
      if (message.includes("validation") || message.includes("invalid")) {
        return ErrorCategory.VALIDATION;
      }
      if (message.includes("api") || message.includes("server")) {
        return ErrorCategory.API;
      }
      return ErrorCategory.RUNTIME;
    }
    return ErrorCategory.UNKNOWN;
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const errorCategory = this.getErrorCategory();
      const errorInfo = ERROR_MESSAGES[errorCategory];

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

            {/* Error Details */}
            {(this.state.error || this.state.errorInfo) && (
              <details className="mb-6 text-left">
                <summary className="text-xs text-muted-foreground cursor-pointer">
                  Technical Details
                </summary>
                <div className="mt-2 space-y-2">
                  {this.state.error && (
                    <pre className="p-2 bg-muted rounded text-xs overflow-x-auto">
                      {this.state.error.message}
                    </pre>
                  )}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs"
                      onClick={this.handleCopyErrorDetails}
                    >
                      {this.state.copied ? (
                        <Check className="w-3 h-3 mr-1" />
                      ) : (
                        <Copy className="w-3 h-3 mr-1" />
                      )}
                      {this.state.copied ? "Copied!" : "Copy Details"}
                    </Button>
                  </div>
                </div>
              </details>
            )}

            {/* Action Buttons */}
            <div className="space-y-3">
              {errorCategory === ErrorCategory.AUTHENTICATION ? (
                <Button onClick={this.handleGoToLogin} className="w-full" size="lg">
                  {errorInfo.action}
                </Button>
              ) : (
                <Button onClick={this.handleRetry} className="w-full" size="lg">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  {errorInfo.action}
                </Button>
              )}

              <div className="flex gap-3">
                <Button onClick={this.handleGoHome} variant="outline" className="flex-1">
                  <Home className="w-4 h-4 mr-2" />
                  Home
                </Button>

                <Button onClick={this.handleReportIssue} variant="ghost" className="flex-1">
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
