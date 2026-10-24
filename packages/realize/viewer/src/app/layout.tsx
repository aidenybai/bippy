import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { GeistMono } from "geist/font/mono";
import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import "./globals.css";

const inter = localFont({
  src: "../../../../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Realize",
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
        {children}
      </ThemeProvider>
    </body>
  </html>
);

export default RootLayout;
