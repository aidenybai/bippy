import type { ReactNode } from "react";
import { Providers as AppProviders } from "/src/app/providers";
import { NextIntlClientProvider } from "/src/i18n/compat/client";
import messages from "/src/i18n/locales/en.json";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <AppProviders>{children}</AppProviders>
    </NextIntlClientProvider>
  );
}
