import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { Nav } from "@/components/nav";
import { Sonner, Toaster } from "@/components/toaster";

export const metadata = { title: "Fixture" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeProvider>
          <Nav />
          <main>{children}</main>
        </ThemeProvider>
        <Toaster />
        <Sonner />
      </body>
    </html>
  );
}
