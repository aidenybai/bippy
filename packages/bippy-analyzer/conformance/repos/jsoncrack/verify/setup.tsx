import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";
import { ThemeProvider } from "styled-components";

const Setup = ({ children }: { children: ReactNode }) => (
  <MantineProvider>
    <ThemeProvider theme={{}}>{children}</ThemeProvider>
  </MantineProvider>
);

export default Setup;
