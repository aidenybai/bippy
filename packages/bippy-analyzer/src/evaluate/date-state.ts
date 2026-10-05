import type { SourceLocation } from "../parse/source-types.js";
import type { JournaledState, StaticValue } from "../types.js";
import type { allocate, branchValue } from "./values.js";

class DateState implements JournaledState<StaticValue> {
  private timestamp: StaticValue;

  constructor(
    private readonly date: Date,
    readonly allocation: number,
    private readonly joinTimestamps: typeof branchValue,
  ) {
    this.timestamp = { kind: "primitive", value: Date.prototype.getTime.call(date) };
  }

  get isConcrete(): boolean {
    return this.timestamp.kind === "primitive" && typeof this.timestamp.value === "number";
  }

  capture(): StaticValue {
    return this.timestamp;
  }

  restore(timestamp: StaticValue): void {
    this.timestamp = timestamp;
    Date.prototype.setTime.call(
      this.date,
      timestamp.kind === "primitive" && typeof timestamp.value === "number" ? timestamp.value : NaN,
    );
  }

  join(
    timestamps: StaticValue[],
    reason: string,
    location: SourceLocation | null,
    preferredPath: number,
    predicate: string | null = null,
  ): void {
    this.restore(this.joinTimestamps(timestamps, reason, location, preferredPath, predicate));
  }
}

const dates = new WeakMap<Date, DateState>();

export const createDateState = (
  date: Date,
  allocateState: typeof allocate,
  joinTimestamps: typeof branchValue,
): DateState => {
  let state = dates.get(date);
  if (!state) {
    state = new DateState(date, allocateState(), joinTimestamps);
    dates.set(date, state);
  }
  return state;
};
