export interface EventListenerMap {
  [event: string]: Array<(...arguments_: unknown[]) => unknown>;
}

const reportGlobalError = (error: unknown): void => {
  if (typeof globalThis.reportError === "function") {
    globalThis.reportError(error);
    return;
  }
  if (typeof window === "object" && typeof window.ErrorEvent === "function") {
    const message =
      typeof error === "object" &&
      error !== null &&
      typeof Reflect.get(error, "message") === "string"
        ? String(Reflect.get(error, "message"))
        : String(error);
    const event = new window.ErrorEvent("error", {
      bubbles: true,
      cancelable: true,
      error,
      message,
    });
    if (!window.dispatchEvent(event)) return;
  }
  console.error(error);
};

export class EventEmitter {
  private readonly listeners = new Map<string, Array<(...arguments_: unknown[]) => unknown>>();

  addListener(event: string, listener: (...arguments_: unknown[]) => unknown): void {
    const listeners = this.listeners.get(event);
    if (!listeners) {
      this.listeners.set(event, [listener]);
      return;
    }
    if (!listeners.includes(listener)) listeners.push(listener);
  }

  emit(event: string, ...arguments_: unknown[]): void {
    const listeners = this.listeners.get(event);
    if (!listeners) return;
    if (listeners.length === 1) {
      Reflect.apply(listeners[0], null, arguments_);
      return;
    }
    let didThrow = false;
    let caughtError: unknown;
    const listenersAtStart = listeners.slice();
    for (const listener of listenersAtStart) {
      try {
        Reflect.apply(listener, null, arguments_);
      } catch (error) {
        if (!didThrow) {
          didThrow = true;
          caughtError = error;
        } else {
          reportGlobalError(error);
        }
      }
    }
    if (didThrow) throw caughtError;
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }

  removeListener(event: string, listener: (...arguments_: unknown[]) => unknown): void {
    const listeners = this.listeners.get(event);
    if (!listeners) return;
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  }
}
