import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import "./globals.css";

export const metadata: Metadata = {
  title: "bippy analyzer",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

const RootLayout = ({ children }: { children: ReactNode }) => (
  <html lang="en" suppressHydrationWarning>
    <body>
      <ThemeProvider
        attribute="class"
        storageKey="bippy-viewer-theme"
        enableSystem
        disableTransitionOnChange
      >
        {children}
      </ThemeProvider>
    </body>
  </html>
);

export default RootLayout;
