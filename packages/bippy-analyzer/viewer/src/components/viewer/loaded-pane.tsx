import type { ReactNode } from "react";
import { useViewer } from "./context";
import { CodeSkeleton } from "./skeletons";

export const ErrorText = ({ children }: { children: ReactNode }) => (
  <pre className="h-full overflow-auto px-4 py-4 font-mono whitespace-pre-wrap text-destructive sm:px-5">
    {children}
  </pre>
);

export const LoadedPane = ({ children }: { children: ReactNode }) => {
  const { view, viewError, isViewLoading } = useViewer();
  if (viewError) return <ErrorText>{viewError}</ErrorText>;
  if (isViewLoading || !view) return <CodeSkeleton />;
  return children;
};
