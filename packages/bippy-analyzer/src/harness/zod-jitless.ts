import { z } from "zod";

// Imported before any schema is built: zod decides at construction whether to
// JIT-compile parsers with `new Function`, which the probed page's `script-src`
// CSP rejects even though the injected script's own eval probe passes.
z.config({ jitless: true });
