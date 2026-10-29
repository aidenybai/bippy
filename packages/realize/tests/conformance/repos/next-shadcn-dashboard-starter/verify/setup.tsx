import { KBarProvider } from "kbar";
import type { ReactNode } from "react";

import AppProviders from "@/components/layout/providers";
import { useAppForm } from "@/lib/form";

export default function Providers({ children }: { children: ReactNode }) {
  const form = useAppForm({ defaultValues: { field: undefined } });
  return (
    <AppProviders activeThemeValue="default">
      <KBarProvider>
        <form.AppForm>
          <form.AppField name="field">{() => children}</form.AppField>
        </form.AppForm>
      </KBarProvider>
    </AppProviders>
  );
}
