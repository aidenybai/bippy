// react-refresh must wrap the DevTools hook before react-dom evaluates,
// exactly like the preamble @vitejs/plugin-react injects in real apps.
import ReactFreshRuntime from "react-refresh/runtime";

ReactFreshRuntime.injectIntoGlobalHook(globalThis);
