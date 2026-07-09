---
"bippy": minor
---

feat: add `bippy/react-refresh` entry point exposing `onReactRefresh`, which observes fast refresh updates bundler-agnostically by wrapping `scheduleRefresh` on renderers injected into the React DevTools global hook (works with Vite, Next.js webpack, Next.js Turbopack, and Metro); the handler receives the updated and stale component types after React re-renders, and the API is SSR-safe (returns null outside a client environment)
