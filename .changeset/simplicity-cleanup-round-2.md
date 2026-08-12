---
"bippy": minor
---

Report an unmount of the last committed fiber when a root loses its current instance (previously this path always threw a TypeError). Second-pass cleanup: shared renderer-dispatcher helpers, shared `getSourceContentFromSourceMap` (adds index-map support to `getDisplayNameFromSource`), and removal of dead options and types (`ParseOptions.slice`, `Effect`, `FiberUpdateQueue.lastEffect`/`dispatch`).
