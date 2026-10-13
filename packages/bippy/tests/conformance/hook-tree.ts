import type { HooksNode } from "bippy/source";

export const getHookLeaves = (hooks: HooksNode[]): HooksNode[] =>
  hooks.flatMap((hook) => (hook.subHooks.length ? getHookLeaves(hook.subHooks) : [hook]));

export const getStateValues = (hooks: HooksNode[]): unknown[] =>
  getHookLeaves(hooks)
    .filter((hook) => hook.name === "State")
    .map((hook) => hook.value);
