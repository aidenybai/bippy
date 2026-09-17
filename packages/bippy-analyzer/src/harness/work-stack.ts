export interface Work<Result> extends Generator<Work<unknown>, Result, unknown> {}

const isWork = (value: unknown): value is Work<unknown> =>
  typeof value === "object" &&
  value !== null &&
  "next" in value &&
  typeof value.next === "function" &&
  "throw" in value &&
  typeof value.throw === "function";

export class WorkStack {
  static *wait<Result>(work: Work<Result> | Result): Work<Result> {
    return isWork(work) ? ((yield work) as Result) : work;
  }

  static *map<Result, Next>(
    work: Work<Result> | Result,
    transform: (result: Result) => Next,
  ): Work<Next> {
    return transform(yield* WorkStack.wait(work));
  }

  static run = <Result>(work: Work<Result>): Result => {
    const pending: Work<unknown>[] = [work];
    let result: unknown;
    let hasError = false;
    while (pending.length > 0) {
      const current = pending[pending.length - 1];
      let step: IteratorResult<Work<unknown>, unknown>;
      try {
        step = hasError ? current.throw(result) : current.next(result);
      } catch (error) {
        pending.pop();
        result = error;
        hasError = true;
        continue;
      }
      hasError = false;
      if (step.done) {
        pending.pop();
        result = step.value;
      } else {
        pending.push(step.value);
        result = undefined;
      }
    }
    if (hasError) throw result;
    return result as Result;
  };
}
