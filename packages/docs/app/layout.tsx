import { Inter } from 'next/font/google';
import { GeistMono } from 'geist/font';
import { RootProvider } from 'fumadocs-ui/provider';
import type { ReactNode } from 'react';
import 'fumadocs-ui/style.css';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body 
        className={`${inter.className} ${GeistMono.variable}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100vh',
        }}
      >
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}

export const metadata = {
  title: 'Bippy Documentation',
  description: 'Documentation for Bippy - a toolkit to hack into React internals',
};
