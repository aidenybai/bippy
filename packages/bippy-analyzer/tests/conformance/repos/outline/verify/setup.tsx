import type { ReactNode } from "react";
import { ThemeProvider } from "styled-components";
import { buildLightTheme } from "/shared/styles/theme";

Object.assign(window, {
  env: {
    ENVIRONMENT: "development",
    URL: "http://localhost:3000",
    CDN_URL: "",
    COLLABORATION_URL: "ws://localhost:3000",
    APP_NAME: "Outline",
    DEFAULT_LANGUAGE: "en_US",
    EMAIL_ENABLED: false,
    VERSION: "0.0.0",
    analytics: [],
  },
});

const theme = buildLightTheme({});

export default function Providers({ children }: { children: ReactNode }) {
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}
