import type { AppProps } from "next/app";
import Script from "next/script";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div id="shell">
      <Component {...pageProps} />
      <Script id="theme" strategy="beforeInteractive">
        {"document.documentElement.dataset.theme = 'light';"}
      </Script>
    </div>
  );
}
