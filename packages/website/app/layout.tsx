import type { Metadata } from 'next';
import Script from "next/script";
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
});

export const metadata: Metadata = {
  title: 'bippy',
  description: 'Hack into React internals',
  icons: {
    icon: '/bippy.png',
  },
  openGraph: {
    title: 'bippy',
    description: 'Hack into React internals',
    images: ['/bippy.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'bippy',
    description: 'Hack into React internals',
    images: ['/bippy.png'],
  },
};

interface RootLayoutProps {
  children: React.ReactNode;
}

const RootLayout = ({ children }: RootLayoutProps) => (
  <html lang="en">
      <head>
        {process.env.NODE_ENV === "development" && (
          <Script
            src="//unpkg.com/react-grab/dist/index.global.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        )}
      </head>
    <body className={`${geist.variable} ${geistMono.variable} font-[family-name:var(--font-geist)] antialiased bg-neutral-950`}>
      {children}
    </body>
  </html>
);

export default RootLayout;
