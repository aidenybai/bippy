import { Suspense, type ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";
import { useIsClient } from "@/hooks/use-is-client";

export const ClientSuspense = ({ children }: { children: ReactNode }) => {
  const isClient = useIsClient();
  const spinner = <Spinner className="h-full" />;
  return isClient ? <Suspense fallback={spinner}>{children}</Suspense> : spinner;
};
