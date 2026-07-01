"use client";

import { Component, ReactNode } from "react";
import { PageError } from "@/components/common/PageError";

interface Props {
  children: ReactNode;
  title?: string;
  message?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class PageErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[PageErrorBoundary]", error, info);
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[60vh] items-center justify-center px-4">
          <PageError
            title={this.props.title ?? "Something went wrong"}
            message={this.props.message}
            onRetry={this.reset}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
