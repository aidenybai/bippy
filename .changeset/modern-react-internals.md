---
"bippy": patch
---

Align hook inspection and component stacks with current React internals. Hook trees now preserve async debug information, support recoverable `use` values, and resolve function-component default props. Server frames use React's current environment format and debug locations, and non-production renderer bundle types are detected consistently with React DevTools.
