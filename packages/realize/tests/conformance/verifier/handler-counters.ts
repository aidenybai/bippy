import type { ComponentAnalysis } from "../../../src/core/types";
import { forEachJsxElement } from "../../../src/core/render/for-each-jsx-element";
import { GeneratedSource } from "../../../src/react-compiler/HIR/HIR";
import type { Counter } from "./types";

interface HandlerCounter {
  counter: Counter;
  handlerId: string;
}

export const collectHandlerCounters = (analysis: ComponentAnalysis): HandlerCounter[] => {
  const handlerCounter: HandlerCounter[] = [];
  forEachJsxElement(analysis.render, (element) => {
    for (const prop of element.props) {
      if (!prop.handlerId || prop.loc === GeneratedSource) continue;
      handlerCounter.push({
        counter: {
          id: `handler:${prop.file}:${prop.loc.start.index}`,
          file: prop.file,
          start: prop.loc.start.index,
          end: prop.loc.end.index,
          kind: element.tag.kind === "BuiltinTag" ? "host-handler" : "component-callbacks",
        },
        handlerId: prop.handlerId,
      });
    }
  });
  return handlerCounter;
};
