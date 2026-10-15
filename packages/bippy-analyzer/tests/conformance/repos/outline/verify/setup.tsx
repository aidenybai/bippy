import "./env";
import { Provider } from "mobx-react";
import type { ReactNode } from "react";
import { ThemeProvider } from "styled-components";
import { buildLightTheme } from "/shared/styles/theme";
import stores from "/app/stores";

const theme = buildLightTheme({});

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <Provider rootStore={stores}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </Provider>
  );
}
