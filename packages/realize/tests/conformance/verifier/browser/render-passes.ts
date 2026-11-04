interface RenderPass {
  dispatcher: object;
  firstHit: number;
}

interface RenderPassTracker {
  (dispatcher: unknown): void;
}

const isRenderingDispatcher = (dispatcher: unknown): dispatcher is object =>
  typeof dispatcher === "object" &&
  dispatcher !== null &&
  Reflect.get(dispatcher, "useEffect") !== Reflect.get(dispatcher, "useCallback");

export const createRenderPassTracker = (
  getHitCount: () => number,
  dropHits: (start: number, end: number) => void,
): RenderPassTracker => {
  let renderPasses: RenderPass[] = [];
  return (dispatcher) => {
    if (!isRenderingDispatcher(dispatcher)) {
      const [firstPass, ...laterPasses] = renderPasses;
      const lastPass = laterPasses.at(-1);
      if (firstPass && lastPass) dropHits(firstPass.firstHit, lastPass.firstHit);
      renderPasses = [];
      return;
    }
    const index = renderPasses.findIndex((pass) => pass.dispatcher === dispatcher);
    const pass = renderPasses[index];
    if (!pass) renderPasses.push({ dispatcher, firstHit: getHitCount() });
    else if (index > 0 && index === renderPasses.length - 1) pass.firstHit = getHitCount();
    else renderPasses.length = index + 1;
  };
};
