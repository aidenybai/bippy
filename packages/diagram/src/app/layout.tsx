import "@stylexswc/webpack-plugin/stylex.css";
import * as stylex from "@stylexjs/stylex";
import { colors } from "tailwind-stylex/tokens.stylex";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeProvider } from "../board/theme-provider";

interface RootLayoutProps {
  children: ReactNode;
}

export const metadata: Metadata = {
  title: "diagram",
};

const styles = stylex.create({
  body: { margin: 0, backgroundColor: colors.neutral50 },
});

const RootLayout = ({ children }: RootLayoutProps) => (
  <html lang="en">
    <body {...stylex.props(styles.body)}>
      <ThemeProvider>{children}</ThemeProvider>
    </body>
  </html>
);

export default RootLayout;
