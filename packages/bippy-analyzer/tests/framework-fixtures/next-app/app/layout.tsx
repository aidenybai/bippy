import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { Hero } from "@/components/hero";
import { Nav } from "@/components/nav";

export const metadata = { title: "Fixture" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeProvider>
          <Nav />
          <Hero />
          <main>{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
