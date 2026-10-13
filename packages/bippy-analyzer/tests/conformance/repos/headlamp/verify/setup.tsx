import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

// The app's modules import each other in cycles, which resolve only in the order its root
// imports them, so they load from there before any component does.
import "/src/App";
import { lightTheme } from "/src/components/App/defaultAppThemes";
import i18n from "/src/i18n/config";
import ThemeProviderNexti18n from "/src/i18n/ThemeProviderNexti18n";
import { createMuiTheme } from "/src/lib/themes";

const theme = createMuiTheme(lightTheme);

/** Mounts every component in the app's theme and translations, as its root does. */
export default function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProviderNexti18n theme={theme}>{children}</ThemeProviderNexti18n>
    </I18nextProvider>
  );
}
