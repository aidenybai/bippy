import { primitiveValue } from "../evaluate/values.js";
import type { StaticPrimitiveValue } from "../types.js";
import type { StaticRenderer } from "./static-renderer.js";
import type { StaticRenderResult } from "./types.js";

export interface IsolatedInputBinding {
  specifier: string;
  exportName: string;
  value: StaticPrimitiveValue["value"];
}

export interface IsolatedAssignment {
  id: string;
  bindings: readonly IsolatedInputBinding[];
}

export interface IsolatedExecutionTarget {
  kind: "entry" | "component";
  filePath: string;
  exportName?: string;
}

export interface IsolatedExecution {
  assignment: IsolatedAssignment;
  isolation: "modeled-state";
  result: StaticRenderResult;
}

export const renderIsolatedAssignments = async (
  renderer: StaticRenderer,
  target: IsolatedExecutionTarget,
  assignments: readonly IsolatedAssignment[],
  maxAssignments = 16,
): Promise<IsolatedExecution[]> => {
  if (
    !Number.isSafeInteger(maxAssignments) ||
    maxAssignments < 1 ||
    assignments.length > maxAssignments
  ) {
    throw new Error("Isolated execution exceeds its finite assignment bound");
  }
  if (renderer.options.externalValues) {
    throw new Error("Isolated assignments cannot reuse an external value provider");
  }
  if (renderer.options.decisions) {
    throw new Error("Isolated assignments constrain input bindings, not materialized decisions");
  }
  const identifiers = new Set<string>();
  const inputs = assignments.map((assignment) => {
    if (identifiers.has(assignment.id)) throw new Error(`Duplicate assignment ${assignment.id}`);
    identifiers.add(assignment.id);
    const modules = new Map<string, Map<string, StaticPrimitiveValue>>();
    for (const binding of assignment.bindings) {
      let exports = modules.get(binding.specifier);
      if (!exports) {
        exports = new Map();
        modules.set(binding.specifier, exports);
      }
      if (exports.has(binding.exportName))
        throw new Error(`Duplicate input ${binding.specifier}#${binding.exportName}`);
      exports.set(binding.exportName, primitiveValue(binding.value));
    }
    return { assignment, modules };
  });
  const executions: IsolatedExecution[] = [];
  for (const { assignment, modules } of inputs) {
    const isolated = renderer.derive({
      externalValues: (specifier, exportName) => modules.get(specifier)?.get(exportName) ?? null,
    });
    const result =
      target.kind === "entry"
        ? await isolated.renderEntry(target.filePath)
        : await isolated.renderComponent(target.filePath, { exportName: target.exportName });
    executions.push({ assignment, isolation: "modeled-state", result });
  }
  return executions;
};
