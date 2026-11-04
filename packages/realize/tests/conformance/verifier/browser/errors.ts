import { Component } from "react";
import type { ComponentType, ErrorInfo, ReactNode } from "react";
import { classifyMountError, getErrorMessage } from "../reasons";
import type { MountFailure } from "../reasons";
import type { CaptureError } from "../types";

interface BoundaryProps {
  children: ReactNode;
}

interface BoundaryState {
  hasError: boolean;
}

interface ChildrenProps {
  children?: ReactNode;
}

const DEPTH_MARKER_PREFIX = "BippyVerifyDepth";
const DEPTH_MARKER_PATTERN = new RegExp(`\\bat ${DEPTH_MARKER_PREFIX}(\\d+)\\b`);

let renderError: CaptureError | null = null;
let caughtError: CaptureError | null = null;
const depthMarkers = new Map<number, ComponentType<ChildrenProps>>();

export const createCaptureError = (
  message: string,
  depth: number | null = null,
  failure: MountFailure = classifyMountError(message),
): CaptureError => ({ message, depth, failure });

export const recordError = (error: unknown, errorInfo?: ErrorInfo): CaptureError => {
  const componentStack = errorInfo?.componentStack;
  return createCaptureError(
    getErrorMessage(error),
    componentStack ? Number(DEPTH_MARKER_PATTERN.exec(componentStack)?.[1] ?? 0) : null,
  );
};

export const recordCaughtError = (error: unknown, errorInfo?: ErrorInfo): void => {
  caughtError ??= recordError(error, errorInfo);
};

export const getRenderError = (): CaptureError | null => renderError;

export const getRecordedError = (): CaptureError | null => renderError ?? caughtError;

export const resetErrors = (): void => {
  renderError = null;
  caughtError = null;
};

export class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError = (): BoundaryState => ({ hasError: true });

  componentDidCatch = (error: unknown, errorInfo: ErrorInfo): void => {
    renderError = recordError(error, errorInfo);
  };

  render = (): ReactNode => (this.state.hasError ? null : this.props.children);
}

export const getDepthMarker = (depth: number): ComponentType<ChildrenProps> => {
  const cached = depthMarkers.get(depth);
  if (cached) return cached;
  const marker = ({ children }: ChildrenProps): ReactNode => children;
  Object.defineProperty(marker, "name", { value: `${DEPTH_MARKER_PREFIX}${depth}` });
  depthMarkers.set(depth, marker);
  return marker;
};

window.addEventListener("error", (event) => recordCaughtError(event.error));
