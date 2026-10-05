import { EngineLimitError } from "./unsupported.js";

export class HostOperations {
  private readonly pending = new Set<Promise<unknown>>();

  track = <Result>(operation: PromiseLike<Result>): Promise<Result> => {
    const promise = Promise.resolve(operation);
    this.pending.add(promise);
    return promise.then(
      (value) => {
        this.pending.delete(promise);
        return value;
      },
      (error: unknown) => {
        this.pending.delete(promise);
        throw error;
      },
    );
  };

  settle = async (): Promise<void> => {
    for (let round = 0; round < 512; round++) {
      await Promise.allSettled(this.pending);
      await new Promise<void>((resolveCheckpoint) => setImmediate(resolveCheckpoint));
      if (this.pending.size === 0) return;
    }
    throw new EngineLimitError("host operation settling");
  };
}
