export type DecisionKind = "truthy" | "nullish" | "count" | "case";

/** One choice the path made where a symbolic reached a control-flow point. */
export interface Decision {
  /** The symbolic expression decided; the same key on any path is the same variable. */
  key: string;
  kind: DecisionKind;
  choice: number;
  alternatives: number;
  site: string;
  /** False for a choice pinned by the explorer, true when this path chose the default. */
  isFresh: boolean;
}

export interface PinnedDecision {
  key: string;
  choice: number;
}

/**
 * Path replay state: choices pinned by the explorer are taken as given; every
 * other symbolic branch takes its default and is recorded as a fork point.
 * A variable decided once stays decided for the rest of the path.
 */
export class DecisionLog {
  private readonly pinned: Map<string, number>;
  private readonly chosen = new Map<string, number>();
  readonly recorded: Decision[] = [];

  constructor(pinned: PinnedDecision[]) {
    this.pinned = new Map(pinned.map(({ key, choice }) => [key, choice]));
  }

  decide(
    key: string,
    kind: DecisionKind,
    site: string,
    alternatives: number,
    defaultChoice: number,
  ): number {
    const previous = this.chosen.get(key);
    if (previous !== undefined) return previous;
    const pinnedChoice = this.pinned.get(key);
    const choice = pinnedChoice ?? defaultChoice;
    this.chosen.set(key, choice);
    this.recorded.push({
      key,
      kind,
      choice,
      alternatives,
      site,
      isFresh: pinnedChoice === undefined,
    });
    return choice;
  }

  peek(key: string): number | undefined {
    return this.chosen.get(key) ?? this.pinned.get(key);
  }
}
