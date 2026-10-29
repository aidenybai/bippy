import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";
import { ThemeProvider } from "styled-components";

import { lightTheme } from "/src/constants/theme";

const Setup = ({ children }: { children: ReactNode }) => (
  <MantineProvider>
    <ThemeProvider theme={lightTheme}>{children}</ThemeProvider>
  </MantineProvider>
);

export default Setup;
