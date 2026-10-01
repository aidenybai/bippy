import { count, identity, increment } from "./counter.js";
import * as sameCounter from "./counter.js";

await Promise.resolve();
export { increment };
export const observe = () => ({
  count,
  same: sameCounter.identity === identity,
  url: import.meta.url,
});
export const load = async () => {
  const lazy = await import("./lazy.js");
  lazy.increment();
  return lazy.identity === identity;
};
