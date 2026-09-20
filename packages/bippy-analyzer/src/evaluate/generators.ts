import type { SourceLocation } from "../parse/source-types.js";
import type { JournaledState, StaticObjectValue, StaticValue, StubRenderTools } from "../types.js";
import { nativeFunction } from "./stubs.js";
import {
  allocate,
  branchValue,
  hasDefiniteItems,
  listValue,
  mapValue,
  objectFromRecord,
  primitiveValue,
  UNDEFINED_VALUE,
  unknownValue,
} from "./values.js";

const iterationResult = (value: StaticValue, done: StaticValue): StaticValue =>
  objectFromRecord({ value, done });

class GeneratorState implements JournaledState<StaticValue> {
  readonly allocation = allocate();
  private position: StaticValue = primitiveValue(0);

  constructor(
    private readonly yields: StaticValue[],
    private readonly returned: StaticValue,
  ) {}

  capture(): StaticValue {
    return this.position;
  }

  restore(position: StaticValue): void {
    this.position = position;
  }

  join(
    positions: StaticValue[],
    reason: string,
    location: SourceLocation | null,
    preferredPath: number,
    predicate: string | null = null,
  ): void {
    this.position = branchValue(positions, reason, location, preferredPath, predicate);
  }

  private mapPosition(operation: (position: number) => StaticValue): StaticValue {
    const visit = (value: StaticValue): StaticValue =>
      mapValue(value, (alternative) => {
        if (alternative.kind === "branch") return visit(alternative);
        return alternative.kind === "primitive" && typeof alternative.value === "number"
          ? operation(alternative.value)
          : unknownValue("generator cursor at an unknown position");
      });
    return visit(this.position);
  }

  next(tools: StubRenderTools): StaticValue {
    if (!hasDefiniteItems(listValue(this.yields)))
      return unknownValue("step of a generator with an uncertain number of yields");
    const result = iterationResult(
      this.mapPosition((position) =>
        position < this.yields.length
          ? this.yields[position]
          : position === this.yields.length
            ? this.returned
            : UNDEFINED_VALUE,
      ),
      this.mapPosition((position) => primitiveValue(position >= this.yields.length)),
    );
    tools.recordStateMutation(this);
    this.position = this.mapPosition((position) =>
      primitiveValue(Math.min(position + 1, this.yields.length + 1)),
    );
    return result;
  }

  finish(tools: StubRenderTools): StaticValue {
    const result = iterationResult(
      this.mapPosition((position) =>
        position === this.yields.length ? this.returned : UNDEFINED_VALUE,
      ),
      primitiveValue(true),
    );
    tools.recordStateMutation(this);
    this.position = primitiveValue(this.yields.length + 1);
    return result;
  }

  remaining(): StaticValue {
    return this.mapPosition((position) =>
      listValue(this.yields.slice(Math.min(position, this.yields.length))),
    );
  }

  consume(recordMutation: StubRenderTools["recordStateMutation"]): StaticValue {
    const remaining = this.remaining();
    recordMutation(this);
    this.position = primitiveValue(this.yields.length + 1);
    return remaining;
  }
}

const generatorsByValue = new WeakMap<StaticObjectValue, GeneratorState>();

export const createGeneratorValue = (
  yields: StaticValue[],
  returned: StaticValue,
): StaticObjectValue => {
  const state = new GeneratorState(yields, returned);
  const generator = objectFromRecord({
    next: nativeFunction("next", (_args, tools) => state.next(tools)),
    return: nativeFunction("return", (_args, tools) => state.finish(tools)),
    throw: nativeFunction("throw", (_args, tools) => state.finish(tools)),
  });
  generatorsByValue.set(generator, state);
  return generator;
};

export const getGeneratorItems = (value: StaticValue): StaticValue | null =>
  (value.kind === "object" ? generatorsByValue.get(value)?.remaining() : null) ?? null;

export const consumeGeneratorItems = (
  value: StaticValue,
  recordMutation: StubRenderTools["recordStateMutation"],
): StaticValue | null =>
  (value.kind === "object" ? generatorsByValue.get(value)?.consume(recordMutation) : null) ?? null;
