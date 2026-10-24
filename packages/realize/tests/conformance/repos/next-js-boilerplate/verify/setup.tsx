import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";

import messages from "@/locales/en.json";

const Setup = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {children}
  </NextIntlClientProvider>
);

export default Setup;
