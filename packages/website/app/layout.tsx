import { type Metadata } from "next";
import { Geist } from "next/font/google";
import Script from "next/script";
import { type ReactNode } from "react";

import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });

export const metadata: Metadata = {
  title: "bippy",
  description: "Escape hatches for React internals.",
};

interface RootLayoutProps {
  children: ReactNode;
}

const RootLayout = (props: RootLayoutProps) => (
  <html lang="en" className={`${geist.variable} dark`}>
    <head>
      {process.env.NODE_ENV === "development" && (
        <Script
          src="//unpkg.com/react-grab@dev/dist/index.global.js"
          crossOrigin="anonymous"
          strategy="beforeInteractive"
        />
      )}
    </head>
    <body>{props.children}</body>
  </html>
);

export default RootLayout;
