import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { GeistMono } from "geist/font/mono";
import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { ThemeFavicon } from "./theme-favicon";

const inter = localFont({
  src: "../../../../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Realize",
  icons: { apple: "/apple-icon.png" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

const RootLayout = ({ children }: { children: ReactNode }) => (
  <html lang="en" className={`${inter.variable} ${GeistMono.variable}`} suppressHydrationWarning>
    <body>
      <ThemeProvider
        attribute="class"
        storageKey="realize-theme"
        enableSystem
        disableTransitionOnChange
      >
        <ThemeFavicon />
        {children}
      </ThemeProvider>
    </body>
  </html>
);

export default RootLayout;
