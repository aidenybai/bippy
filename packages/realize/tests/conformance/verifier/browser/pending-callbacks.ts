export const SHORT_CALLBACK_MS = 40;

export const nativeSetTimeout = window.setTimeout.bind(window);
export const nativeClearTimeout = window.clearTimeout.bind(window);
const nativeSetInterval = window.setInterval.bind(window);
const nativeClearInterval = window.clearInterval.bind(window);
export const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
const nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
const pendingTimers = new Set<number>();
const pendingFrames = new Set<number>();
let pendingObservations = 0;
let timerScheduledAt = Number.NEGATIVE_INFINITY;
const actionTimers = new Set<number>();
let isTrackingActionTimers = false;

window.setTimeout = ((handler: TimerHandler, timeout?: number, ...timerArguments: unknown[]) => {
  const isShort = Number(timeout ?? 0) <= SHORT_CALLBACK_MS;
  if (typeof handler !== "function" || (!isShort && !isTrackingActionTimers))
    return nativeSetTimeout(handler, timeout, ...timerArguments);
  const timers = isShort ? pendingTimers : actionTimers;
  const timerId = nativeSetTimeout(() => {
    timers.delete(timerId);
    Reflect.apply(handler, window, timerArguments);
  }, timeout);
  timers.add(timerId);
  if (isShort) timerScheduledAt = performance.now();
  return timerId;
}) as typeof window.setTimeout;

window.clearTimeout = ((timerId?: number): void => {
  if (timerId !== undefined) pendingTimers.delete(timerId);
  if (timerId !== undefined) actionTimers.delete(timerId);
  nativeClearTimeout(timerId);
}) as typeof window.clearTimeout;

window.setInterval = ((handler: TimerHandler, timeout?: number, ...timerArguments: unknown[]) => {
  const intervalId = nativeSetInterval(handler, timeout, ...timerArguments);
  if (isTrackingActionTimers) actionTimers.add(intervalId);
  return intervalId;
}) as typeof window.setInterval;

window.clearInterval = ((intervalId?: number): void => {
  if (intervalId !== undefined) actionTimers.delete(intervalId);
  nativeClearInterval(intervalId);
}) as typeof window.clearInterval;

window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
  const frameId = nativeRequestAnimationFrame((time) => {
    pendingFrames.delete(frameId);
    callback(time);
  });
  pendingFrames.add(frameId);
  return frameId;
};

window.cancelAnimationFrame = (frameId: number): void => {
  pendingFrames.delete(frameId);
  nativeCancelAnimationFrame(frameId);
};

interface ObservationCount {
  pending: number;
}

const settleObservations = (count: ObservationCount): void => {
  pendingObservations -= count.pending;
  count.pending = 0;
};

const NativeIntersectionObserver = window.IntersectionObserver;
window.IntersectionObserver = class extends NativeIntersectionObserver {
  readonly #count: ObservationCount;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    const count = { pending: 0 };
    super((entries, observer) => {
      settleObservations(count);
      callback(entries, observer);
    }, options);
    this.#count = count;
  }

  override observe(target: Element): void {
    this.#count.pending++;
    pendingObservations++;
    super.observe(target);
  }

  override disconnect(): void {
    settleObservations(this.#count);
    super.disconnect();
  }
};

const NativeResizeObserver = window.ResizeObserver;
window.ResizeObserver = class extends NativeResizeObserver {
  readonly #count: ObservationCount;

  constructor(callback: ResizeObserverCallback) {
    const count = { pending: 0 };
    super((entries, observer) => {
      settleObservations(count);
      callback(entries, observer);
    });
    this.#count = count;
  }

  override observe(target: Element, options?: ResizeObserverOptions): void {
    this.#count.pending++;
    pendingObservations++;
    super.observe(target, options);
  }

  override disconnect(): void {
    settleObservations(this.#count);
    super.disconnect();
  }
};

const PASSIVE_EFFECT_FLAGS = 2048 | 8192 | 16;
let hasPendingPassiveEffects = false;

export const recordCommitFlags = (flags: number): void => {
  hasPendingPassiveEffects = (flags & PASSIVE_EFFECT_FLAGS) !== 0;
};

export const recordPassiveFlush = (): void => {
  hasPendingPassiveEffects = false;
};

export const hasPendingPassiveFlush = (): boolean => hasPendingPassiveEffects;

export const hasPendingCallbacks = (): boolean =>
  pendingTimers.size > 0 || pendingFrames.size > 0 || pendingObservations > 0;

export const trackActionTimers = (isTracking: boolean): void => {
  if (isTracking) actionTimers.clear();
  isTrackingActionTimers = isTracking;
};

export const hasPendingActionTimers = (): boolean => actionTimers.size > 0;

export const hasTimerScheduledSince = (time: number): boolean =>
  pendingTimers.size > 0 && timerScheduledAt >= time;
