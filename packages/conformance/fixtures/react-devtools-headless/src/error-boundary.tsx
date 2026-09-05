import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { logErrorEvent } from "./logger.js";
import type { ErrorEventSource } from "./logger.js";

export interface ErrorBoundaryProps {
  children: ReactNode;
  store?: ErrorEventSource;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logErrorEvent(error, info.componentStack ?? null);
  }

  componentDidMount(): void {
    this.props.store?.addListener("error", this.onStoreError);
  }

  componentWillUnmount(): void {
    this.props.store?.removeListener("error", this.onStoreError);
  }

  render(): ReactNode {
    return this.state.error ? `Uncaught Error: ${this.state.error.message}` : this.props.children;
  }

  private readonly onStoreError = (...arguments_: unknown[]): void => {
    const error = arguments_[0];
    if (!this.state.error && error instanceof Error) this.setState({ error });
  };
}
