import { TimerQueue, type ScheduledTask } from "../evaluate/timers.js";

interface ClockTimer {
  handle: number;
  deadline: number;
  delay: number;
  repeat: boolean;
  nesting: number;
  callback: () => void;
}

export class VirtualClock {
  now = 0;
  readonly epoch = 1_700_000_000_000;
  private nextHandle = 0;
  private isScheduled = false;
  private readonly pending = new Map<number, ClockTimer>();
  private readonly nesting = new WeakMap<ScheduledTask, number>();

  constructor(readonly tasks: TimerQueue) {}

  private schedulePump = (): void => {
    if (this.isScheduled || this.pending.size === 0) return;
    this.isScheduled = true;
    this.tasks.enqueue(() => {
      this.isScheduled = false;
      const timer = [...this.pending.values()].sort(
        (left, right) => left.deadline - right.deadline || left.handle - right.handle,
      )[0];
      if (!timer) return;
      this.now = Math.max(this.now, timer.deadline);
      if (this.tasks.currentTask) this.nesting.set(this.tasks.currentTask, timer.nesting);
      if (!timer.repeat) this.pending.delete(timer.handle);
      try {
        timer.callback();
      } finally {
        if (timer.repeat && this.pending.has(timer.handle)) {
          timer.delay = Math.max(timer.nesting > 5 ? 4 : 0, timer.delay);
          timer.nesting += 1;
          timer.deadline = this.now + timer.delay;
        }
        this.schedulePump();
      }
    });
  };

  private schedule = (
    callback: unknown,
    delay: unknown,
    args: unknown[],
    repeat: boolean,
  ): number => {
    if (typeof callback !== "function") throw new TypeError("Only callback timers are supported");
    const milliseconds: number = Reflect.apply(Math.trunc, undefined, [delay]);
    let nesting = 0;
    for (let task = this.tasks.currentTask; task; task = task.parent) {
      const level = this.nesting.get(task);
      if (level !== undefined) {
        nesting = level;
        break;
      }
    }
    const normalized = Math.max(nesting > 5 ? 4 : 0, milliseconds | 0);
    const handle = ++this.nextHandle;
    this.pending.set(handle, {
      handle,
      deadline: this.now + normalized,
      delay: normalized,
      nesting: nesting + 1,
      repeat,
      callback: () => Reflect.apply(callback, undefined, args),
    });
    this.schedulePump();
    return handle;
  };

  setTimeout = (callback: unknown, delay: unknown = 0, ...args: unknown[]): number =>
    this.schedule(callback, delay, args, false);
  setInterval = (callback: unknown, delay: unknown = 0, ...args: unknown[]): number =>
    this.schedule(callback, delay, args, true);
  clearTimeout = (handle: unknown): void => {
    const identifier: number = Reflect.apply(Math.trunc, undefined, [handle]);
    this.pending.delete(identifier >>> 0);
  };
  requestAnimationFrame = (callback: unknown): number => {
    if (typeof callback !== "function") throw new TypeError("Expected an animation frame callback");
    return this.setTimeout(
      () => Reflect.apply(callback, undefined, [this.now]),
      16 - (this.now % 16),
    );
  };
  createDate = (): typeof Date => {
    const prototype = new Date(Number.NaN);
    Object.setPrototypeOf(prototype, Object.prototype);
    Object.defineProperties(prototype, Object.getOwnPropertyDescriptors(Date.prototype));
    const target = Date.bind(null);
    const now = () => this.epoch + this.now;
    Object.defineProperties(target, {
      prototype: { value: prototype },
      name: { value: "Date", configurable: true },
      now: { value: now, writable: true, configurable: true },
      parse: Object.getOwnPropertyDescriptor(Date, "parse") ?? {},
      UTC: Object.getOwnPropertyDescriptor(Date, "UTC") ?? {},
    });
    const constructor = new Proxy(target, {
      apply: () => new Date(now()).toString(),
      construct: (_target, args, newTarget) =>
        Reflect.construct(Date, args.length ? args : [now()], newTarget),
    });
    Object.defineProperty(prototype, "constructor", {
      value: constructor,
      writable: true,
      configurable: true,
    });
    return constructor;
  };
}
