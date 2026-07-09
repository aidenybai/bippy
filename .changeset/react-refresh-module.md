---
"bippy": minor
---

feat: add `bippy/react-refresh` entry point with `onReactRefresh`, which observes fast refresh updates bundler-agnostically by wrapping `scheduleRefresh` on renderers injected into the React DevTools global hook (works with Vite, Next.js webpack, Next.js Turbopack, and Metro), and `detectHmrTransport`, which subscribes to the dev server's HMR transport (Next.js webpack, Metro for React Native, Vite) and reports hot-updated source file paths; everything is SSR-safe and resolves null outside a client dev environment
