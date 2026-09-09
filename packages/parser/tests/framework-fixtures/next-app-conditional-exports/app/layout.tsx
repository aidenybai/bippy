import type { ReactNode } from "react";
import { getGreeting, isServerBuild } from "greeting-kit";
import { GreetingProvider } from "greeting-kit/provider";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const greeting = await getGreeting();
  return (
    <html lang="en">
      <body data-server-build={isServerBuild}>
        <GreetingProvider greeting={greeting}>{children}</GreetingProvider>
      </body>
    </html>
  );
}
