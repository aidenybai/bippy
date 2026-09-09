import type { ImageLoadOutcome } from "../types.js";

/**
 * Images the page loads outside the document (`new Image()` preloaders) are
 * reachable only through the elements themselves, so every image that had a
 * `src` assigned is kept; images in the document are read from it at snapshot
 * time. Must run before the app's scripts.
 */
export const installImageTracker = (): (() => Record<string, ImageLoadOutcome>) => {
  const assignedImages = new Set<HTMLImageElement>();
  const sourceDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
  const setSource = sourceDescriptor?.set;
  if (sourceDescriptor && setSource) {
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      ...sourceDescriptor,
      set(this: HTMLImageElement, source: string) {
        assignedImages.add(this);
        setSource.call(this, source);
      },
    });
  }
  return () => {
    const outcomes: Record<string, ImageLoadOutcome> = {};
    const conflicting = new Set<string>();
    for (const image of [...assignedImages, ...Array.from(document.images)]) {
      const url = image.src;
      if (!url || !image.complete) continue;
      const outcome: ImageLoadOutcome = image.naturalWidth > 0 ? "loaded" : "error";
      if (url in outcomes && outcomes[url] !== outcome) conflicting.add(url);
      outcomes[url] = outcome;
    }
    for (const url of conflicting) delete outcomes[url];
    return outcomes;
  };
};
