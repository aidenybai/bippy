import { EventEmitter } from "./event-emitter.js";

export interface LoggerEvent {
  error_component_stack?: string | null;
  error_message?: string | null;
  error_stack?: string | null;
  event_name: string;
  metadata?: Record<string, unknown>;
}

export interface ErrorEventSource {
  addListener: (event: string, listener: (...arguments_: unknown[]) => unknown) => void;
  removeListener: (event: string, listener: (...arguments_: unknown[]) => unknown) => void;
}

const loggers = new Set<(event: LoggerEvent) => void | Promise<void>>();

const logEvent = (event: LoggerEvent): void => {
  for (const logger of loggers) logger(event);
};

export const registerEventLogger = (
  logger: (event: LoggerEvent) => void | Promise<void>,
): (() => void) => {
  loggers.add(logger);
  return () => loggers.delete(logger);
};

export const logErrorEvent = (error: unknown, componentStack: string | null): void => {
  const errorMessage =
    typeof error === "object" && error !== null && typeof Reflect.get(error, "message") === "string"
      ? Reflect.get(error, "message")
      : null;
  const errorStack =
    typeof error === "object" && error !== null && typeof Reflect.get(error, "stack") === "string"
      ? Reflect.get(error, "stack")
      : null;
  logEvent({
    error_component_stack: componentStack,
    error_message: errorMessage,
    error_stack: errorStack,
    event_name: "error",
  });
};

export const subscribeToStoreErrors = (
  store: ErrorEventSource,
  bridge?: ErrorEventSource,
): (() => void) => {
  const onError = (error: unknown) => logErrorEvent(error, null);
  let isSubscribed = true;
  const unsubscribe = (): void => {
    if (!isSubscribed) return;
    isSubscribed = false;
    store.removeListener("error", onError);
    bridge?.removeListener("shutdown", unsubscribe);
  };
  store.addListener("error", onError);
  bridge?.addListener("shutdown", unsubscribe);
  return unsubscribe;
};

export class StoreErrorSource extends EventEmitter {
  throwAndEmitError(error: Error): never {
    this.emit("error", error);
    throw error;
  }
}

let hasRegisteredEventLogger = false;

export const registerDevToolsEventLogger = (surface: string, loggingUrl?: string): void => {
  if (hasRegisteredEventLogger || !loggingUrl || !document.body) return;
  hasRegisteredEventLogger = true;
  const iframe = document.createElement("iframe");
  iframe.src = loggingUrl;
  const sessionId = window.crypto.randomUUID();
  registerEventLogger((event) => {
    iframe.contentWindow?.postMessage(
      {
        context: { session_id: sessionId, surface },
        event,
        source: "react-devtools-logging",
      },
      "*",
    );
  });
  document.body.appendChild(iframe);
};
