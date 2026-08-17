import { getRDTHook } from "./rdt-hook.js";

// Importing bippy must never crash module evaluation, even when a foreign
// hook is frozen or otherwise rejects patching.
try {
  getRDTHook();
} catch {}
