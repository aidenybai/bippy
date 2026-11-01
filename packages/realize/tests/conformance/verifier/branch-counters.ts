import type { ComponentAnalysis } from "../../../src/core/types";
import { appendToGroup } from "../../../src/core/shared/append-to-group";
import { forEachRenderNode } from "../../../src/core/render/for-each-render-node";
import { getLocationKey } from "../../../src/core/shared/get-location-key";
import { GeneratedSource } from "../../../src/react-compiler/HIR/HIR";
import { collectHandlerCounters } from "./handler-counters";
import type { Counter } from "./types";
import type { types } from "@babel/core";

export const getBranchId = (file: string, loc: types.SourceLocation): string =>
  `${file}:${getLocationKey(loc)}`;

export const getEdgeKey = (counterId: string, isConsequent: boolean): string =>
  `${counterId}:${isConsequent}`;

export const collectBranchCounters = (analysis: ComponentAnalysis): Counter[] => {
  const counters = new Map<string, Counter>();
  forEachRenderNode(analysis.render, (value) => {
    if (value.kind !== "Conditional") return;
    const { branch } = value;
    if (branch.testKind === null || branch.loc === GeneratedSource) return;
    const id = getBranchId(branch.file, branch.loc);
    counters.set(id, {
      id,
      file: branch.file,
      start: branch.loc.start.index,
      end: branch.loc.end.index,
      kind: branch.testKind,
    });
  });
  return [...counters.values()];
};

export const getHandlerIdsByCounterId = (analysis: ComponentAnalysis): Map<string, string[]> => {
  const handlerIdsByCounterId = new Map<string, string[]>();
  for (const { counter, handlerId } of collectHandlerCounters(analysis))
    appendToGroup(handlerIdsByCounterId, counter.id, handlerId);
  return handlerIdsByCounterId;
};
