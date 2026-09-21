import {
  mapGuardVariables,
  simplifyGuard,
  type Guard,
  type GuardContext,
  type InputVariable,
  type SymbolicCardinality,
  type SymbolicPredicate,
  type SymbolicVariable,
} from "./guards.js";

const compareInputIds = (left: string, right: string): number =>
  left.localeCompare(right, undefined, { numeric: true });

export class InputRenamer {
  private readonly identities = new Map<string, string>();

  constructor(inputs: Iterable<string> = []) {
    for (const input of [...new Set(inputs)].sort(compareInputIds)) {
      this.renameInput(input);
    }
  }

  private renameInput(input: string): string {
    let renamed = this.identities.get(input);
    if (renamed === undefined) {
      renamed = `#${this.identities.size + 1}`;
      this.identities.set(input, renamed);
    }
    return renamed;
  }

  renameVariable(variable: SymbolicVariable): SymbolicVariable {
    return { ...variable, input: this.renameInput(variable.input) };
  }

  renameInputs(inputs: InputVariable[]): InputVariable[] {
    return inputs
      .map((input) => ({ ...input, id: this.renameInput(input.id) }))
      .sort((left, right) => compareInputIds(left.id, right.id));
  }

  renameGuard(guard: Guard): Guard {
    return simplifyGuard(mapGuardVariables(guard, (variable) => this.renameVariable(variable)));
  }

  renameContext(context: GuardContext): GuardContext {
    return { guard: this.renameGuard(context.guard), inputs: this.renameInputs(context.inputs) };
  }

  renamePredicate(predicate: SymbolicPredicate): SymbolicPredicate {
    return {
      formula: predicate.formula && this.renameGuard(predicate.formula),
      choice: predicate.choice && this.renameVariable(predicate.choice),
      guards: predicate.guards?.map((guard) => this.renameGuard(guard)) ?? null,
      inputs: this.renameInputs(predicate.inputs),
    };
  }

  renameCardinality(cardinality: SymbolicCardinality): SymbolicCardinality {
    return {
      variable: this.renameVariable(cardinality.variable),
      inputs: this.renameInputs(cardinality.inputs),
    };
  }
}
