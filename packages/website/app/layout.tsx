import type { Metadata } from 'next';
import Script from 'next/script';
import { IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const ibmPlexMono = IBM_Plex_Mono({
  variable: '--font-ibm-plex-mono',
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'bippy',
  description: 'hack into react internals',
  icons: {
    icon: '/logo.png',
  },
  openGraph: {
    title: 'bippy',
    description: 'hack into react internals',
    images: ['/thumbnail.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'bippy',
    description: 'hack into react internals',
    images: ['/thumbnail.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" style={{ colorScheme: 'dark' }}>
      <head>
        {process.env.NODE_ENV === 'development' && (
          <Script
            src="//unpkg.com/react-grab/dist/index.global.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        )}
      </head>
      <body
        className={`${ibmPlexMono.variable} antialiased bg-[#111111] text-[#e8e8e8] font-mono tracking-tighter`}
      >
        {children}
      </body>
    </html>
  );
}
