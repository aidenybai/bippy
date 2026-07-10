---
"bippy": minor
---

feat: add `bippy/react-refresh` entry point exposing `instrumentReactRefresh({ onRefresh })`, which observes fast refresh updates bundler-agnostically by wrapping `scheduleRefresh` on renderers injected into the React DevTools global hook (works with Vite, Next.js webpack, Next.js Turbopack, and Metro); the handler receives the updated and stale component types after React re-renders, plus the hot-updated source file paths reported by the auto-detected bundler HMR transport (Vite, Next.js webpack, or Metro), and the API is SSR-safe (returns an unsubscribe function, a no-op outside a client environment)
