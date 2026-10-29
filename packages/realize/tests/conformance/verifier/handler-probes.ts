import type { ComponentAnalysis } from "../../../src/core/types";
import { forEachJsxElement } from "../../../src/core/states/for-each-jsx-element";
import { GeneratedSource } from "../../../src/react-compiler/HIR/HIR";
import type { Probe } from "./types";

export interface HandlerProbe {
  probe: Probe;
  handlerId: string;
}

export const collectHandlerProbes = (analysis: ComponentAnalysis): HandlerProbe[] => {
  const handlerProbes: HandlerProbe[] = [];
  forEachJsxElement(analysis.render, (element) => {
    for (const prop of element.props) {
      if (!prop.handlerId || prop.loc === GeneratedSource) continue;
      handlerProbes.push({
        probe: {
          id: `handler:${prop.file}:${prop.loc.start.index}`,
          file: prop.file,
          start: prop.loc.start.index,
          end: prop.loc.end.index,
          mode: element.tag.kind === "BuiltinTag" ? "handler" : "callbacks",
        },
        handlerId: prop.handlerId,
      });
    }
  });
  return handlerProbes;
};
