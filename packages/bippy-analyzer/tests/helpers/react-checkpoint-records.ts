import type { ContinuationStateRoots, ObjectValue } from "../../engine/dist/declaration/index.mjs";
import type { SymbolicEngine } from "../../src/symbolic/load-engine.js";

export interface ReactCheckpointRecords {
  fiber: ObjectValue;
  queue: ObjectValue;
  update: ObjectValue;
}

export const getReactCheckpointRecords = (
  api: SymbolicEngine["api"],
  roots: ContinuationStateRoots,
): ReactCheckpointRecords => {
  const environments = new Set(
    roots.values.filter((value) => value instanceof api.EnvironmentRecord),
  );
  for (const context of api.surroundingAgent.executionContextStack) {
    if (context.LexicalEnvironment) environments.add(context.LexicalEnvironment);
  }
  const objects = new Set(roots.values.filter((value) => value instanceof api.ObjectValue));
  for (const environment of environments) {
    if (environments.size > 1000)
      throw new Error("React checkpoint environment audit exceeded its limit");
    if (environment.OuterEnv) environments.add(environment.OuterEnv);
    if (environment instanceof api.DeclarativeEnvironmentRecord) {
      for (const binding of environment.bindings.values()) {
        const value: unknown = Object.getOwnPropertyDescriptor(binding, "value")?.value;
        if (value instanceof api.ObjectValue) objects.add(value);
      }
    }
  }
  const findRecord = (fields: readonly string[]) => {
    const matches = [...objects].filter((object) =>
      fields.every((field) => object.properties.has(field)),
    );
    if (matches.length !== 1)
      throw new Error(`Expected one React record with ${fields.join(", ")}`);
    return matches[0];
  };
  return {
    fiber: findRecord(["alternate", "memoizedState", "childLanes"]),
    queue: findRecord(["lastRenderedState", "lastRenderedReducer", "dispatch"]),
    update: findRecord(["hasEagerState", "eagerState", "revertLane"]),
  };
};
