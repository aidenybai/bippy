import type { ReactNode } from "react";

import { useAppForm } from "@/lib/form";

/**
 * Mounts every component inside a form and one of its fields, as the app renders its field
 * components through `form.AppField`.
 */
export default function Providers({ children }: { children: ReactNode }) {
  const form = useAppForm({ defaultValues: { field: undefined } });
  return (
    <form.AppForm>
      <form.AppField name="field">{() => children}</form.AppField>
    </form.AppForm>
  );
}
