---
"bippy": minor
---

feat: add `bippy/react-refresh` entry point with `detectHmrTransport`, which subscribes to the dev server's HMR transport (Next.js webpack, Metro for React Native, Vite) and reports hot-updated source file paths; all transports are SSR-safe and resolve null outside a client dev environment
