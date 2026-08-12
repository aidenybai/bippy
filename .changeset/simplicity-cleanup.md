---
"bippy": minor
---

Remove dead code and deduplicate shared logic. Fix `getDisplayNameFromSource` mapping already-symbolicated frames through the source map twice, and extract the declaration closest to the mapped line so adjacent components no longer shadow the right name. Removes unused public types (`StackFrame.args`, `ParseOptions.allowEmpty`, `RenderHandler`'s state parameter, and react-reconciler type re-exports nothing consumes — import those from `react-reconciler` directly).
