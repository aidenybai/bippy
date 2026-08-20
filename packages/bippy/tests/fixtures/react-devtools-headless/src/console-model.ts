export interface ConsoleModelSettings {
  disableSecondLogDimming?: boolean;
  hideStrictModeLogs?: boolean;
}

export interface ConsoleModel {
  error: (...arguments_: unknown[]) => void;
  log: (...arguments_: unknown[]) => void;
  runStrictSecondPass: (callback: () => void) => void;
  warn: (...arguments_: unknown[]) => void;
}

export interface ConsoleTarget {
  error: (...arguments_: unknown[]) => void;
  log: (...arguments_: unknown[]) => void;
  warn: (...arguments_: unknown[]) => void;
}

export interface ConsoleModelOptions {
  getCurrentStack: () => string | null;
  settings?: ConsoleModelSettings;
  target: ConsoleTarget;
}

const hasComponentStack = (arguments_: unknown[]): boolean =>
  arguments_.some((argument) => typeof argument === "string" && /\n\s+(?:at|in)\s+/.test(argument));

export const createConsoleModel = ({
  getCurrentStack,
  settings = {},
  target,
}: ConsoleModelOptions): ConsoleModel => {
  let isStrictSecondPass = false;

  const call = (
    method: ConsoleTarget["log"],
    shouldAppendStack: boolean,
    arguments_: unknown[],
  ): void => {
    if (isStrictSecondPass && settings.hideStrictModeLogs) return;
    const output = [...arguments_];
    if (shouldAppendStack && !hasComponentStack(output)) {
      const stack = getCurrentStack();
      if (stack) output.push(stack);
    }
    if (isStrictSecondPass && !settings.disableSecondLogDimming) {
      output.unshift("color: rgba(124, 124, 124, 0.75)");
      output.unshift("%c");
    }
    Reflect.apply(method, target, output);
  };

  return {
    error: (...arguments_) => call(target.error, true, arguments_),
    log: (...arguments_) => call(target.log, false, arguments_),
    runStrictSecondPass: (callback) => {
      isStrictSecondPass = true;
      try {
        callback();
      } finally {
        isStrictSecondPass = false;
      }
    },
    warn: (...arguments_) => call(target.warn, true, arguments_),
  };
};
