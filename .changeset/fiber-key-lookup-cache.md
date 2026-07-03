---
"bippy": patch
---

perf: cache the React fiber property key in getFiberFromHostInstance so repeated lookups are a single property read instead of a for-in over every inherited DOM accessor
