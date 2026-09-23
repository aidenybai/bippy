export function getContext() {
  if (globalThis.__bippyKeaThrow) throw new Error("kea context failed");
  return globalThis.__bippyKeaVite;
}
