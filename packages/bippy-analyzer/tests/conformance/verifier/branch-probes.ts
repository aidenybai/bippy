import type { ComponentAnalysis } from "../../../src/core/types";
import { appendToGroup } from "../../../src/core/utils/append-to-group";
import { forEachRenderNode } from "../../../src/core/utils/for-each-render-node";
import { getLocationKey } from "../../../src/core/utils/get-location-key";
import { GeneratedSource } from "../../../src/react-compiler/HIR/HIR";
import { collectHandlerProbes } from "./handler-probes";
import type { Probe } from "./types";
import type { types } from "@babel/core";

export const getPathKey = (path: string[]): string => JSON.stringify(path);

export const getProbeId = (file: string, loc: types.SourceLocation): string =>
  `${file}:${getLocationKey(loc)}`;

export const getSideKey = (probeId: string, isTrueSide: boolean): string =>
  `${probeId}:${isTrueSide}`;

export const collectProbes = (analysis: ComponentAnalysis): Probe[] => {
  const probes = new Map<string, Probe>();
  forEachRenderNode(analysis.render, (value) => {
    if (value.kind !== "Conditional") return;
    const { branch } = value;
    if (branch.probe === "none" || branch.loc === GeneratedSource) return;
    const id = getProbeId(branch.file, branch.loc);
    probes.set(id, {
      id,
      file: branch.file,
      start: branch.loc.start.index,
      end: branch.loc.end.index,
      mode: branch.probe,
    });
  });
  return [...probes.values()];
};

export const getHandlerIdsByProbeId = (analysis: ComponentAnalysis): Map<string, string[]> => {
  const handlerIdsByProbeId = new Map<string, string[]>();
  for (const { probe, handlerId } of collectHandlerProbes(analysis))
    appendToGroup(handlerIdsByProbeId, probe.id, handlerId);
  return handlerIdsByProbeId;
};
