import React, { Component, ReactNode } from 'react';

export interface ErrorBoundaryProps {
  children: ReactNode;
  maxRetries?: number;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
}

/**
 * Component for Advanced Error Recovery with Retry Logic (Resolves #598)
 */
export class ErrorBoundaryWithRetry extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, retryCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  handleRetry = () => {
    this.setState((prevState) => ({
      hasError: false,
      error: null,
      retryCount: prevState.retryCount + 1,
    }));
  };

  render() {
    const { maxRetries = 3 } = this.props;

    if (this.state.hasError) {
      return (
        <div className="error-recovery p-4 bg-red-100 border border-red-400 rounded text-red-700">
          <h2>Something went wrong.</h2>
          <p>{this.state.error?.message}</p>
          {this.state.retryCount < maxRetries ? (
            <button
              onClick={this.handleRetry}
              className="mt-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            >
              Retry
            </button>
          ) : (
            <p>Maximum retries exceeded. Please contact support.</p>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
