import { KBarProvider } from "kbar";
import type { ReactNode } from "react";

import AppProviders from "@/components/layout/providers";
import { useAppForm } from "@/lib/form";

/**
 * Mounts every component in the app's own providers and the command bar's, which its
 * dashboard layout adds, and inside a form and one of its fields, as the app renders its
 * field components through `form.AppField`.
 */
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
