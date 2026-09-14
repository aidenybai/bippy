import type { StaticObjectValue, StaticValue } from "../types.js";
import { getTruthinessPredicate } from "./predicates.js";
import {
  allocate,
  branchValue,
  FALSE_VALUE,
  getObjectProperty,
  getTruthiness,
  mapValue,
  objectFromRecord,
  setObjectProperty,
  TRUE_VALUE,
  UNDEFINED_VALUE,
} from "./values.js";

export interface GlobalPropertyState {
  value: StaticValue;
  present: StaticValue;
}

export class GlobalProperties {
  private readonly allocation = allocate();
  private readonly cells = new Map<string, StaticObjectValue>();

  constructor(
    private readonly recordMutation: (cell: StaticObjectValue) => void,
    private readonly getInitial: (name: string) => GlobalPropertyState = () => ({
      value: UNDEFINED_VALUE,
      present: FALSE_VALUE,
    }),
  ) {}

  has = (name: string): StaticValue | undefined => {
    const cell = this.cells.get(name);
    return cell && getObjectProperty(cell, "present");
  };

  get = (name: string, missing: StaticValue = UNDEFINED_VALUE): StaticValue | undefined => {
    const cell = this.cells.get(name);
    if (!cell) return undefined;
    return mapValue(getObjectProperty(cell, "present"), (present) =>
      getTruthiness(present) === true
        ? getObjectProperty(cell, "value")
        : getTruthiness(present) === false
          ? missing
          : branchValue(
              [getObjectProperty(cell, "value"), missing],
              `initial global ${name}`,
              null,
              0,
              getTruthinessPredicate(present),
            ),
    );
  };

  set = (name: string, value: StaticValue, isUncertain = false): void => {
    this.write(name, { value, present: TRUE_VALUE }, isUncertain);
  };

  delete = (name: string, isUncertain = false): void => {
    this.write(name, { value: UNDEFINED_VALUE, present: FALSE_VALUE }, isUncertain);
  };

  private write = (name: string, state: GlobalPropertyState, isUncertain: boolean): void => {
    const cell = this.getCell(name);
    this.recordMutation(cell);
    if (isUncertain) {
      const previous = objectFromRecord({
        value: getObjectProperty(cell, "value"),
        present: getObjectProperty(cell, "present"),
      });
      cell.entries = [
        {
          kind: "spread",
          value: branchValue(
            [objectFromRecord({ value: state.value, present: state.present }), previous],
            `uncertain write to global ${name}`,
          ),
        },
      ];
      return;
    }
    setObjectProperty(cell, "value", state.value);
    setObjectProperty(cell, "present", state.present);
  };

  private getCell = (name: string): StaticObjectValue => {
    let cell = this.cells.get(name);
    if (!cell) {
      const initial = this.getInitial(name);
      cell = objectFromRecord({ present: initial.present, value: initial.value });
      cell.allocation = this.allocation;
      this.cells.set(name, cell);
    }
    return cell;
  };
}
