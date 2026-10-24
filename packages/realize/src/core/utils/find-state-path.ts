import type { Region, State } from "../types";

export const findStatePath = (states: State[], regions: Region[], target: number): string[] => {
  const region = regions.find((candidate) => candidate.states.includes(target));
  const start = region?.firstRenderState ?? null;
  if (start === null) return [];
  const previous = new Map<number, [number, string]>();
  const queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    if (current === undefined || current === target) break;
    for (const transition of states[current]?.transitions ?? [])
      for (const next of transition.targets)
        if (next !== start && !previous.has(next)) {
          previous.set(next, [current, transition.handlerId]);
          queue.push(next);
        }
  }
  const path: string[] = [];
  for (let step = previous.get(target); step; step = previous.get(step[0])) path.unshift(step[1]);
  return path;
};
