export const createEngineConsole = (): Record<string, () => void> =>
  Object.fromEntries(
    ["log", "warn", "error", "info", "debug", "trace", "group", "groupCollapsed", "groupEnd"].map(
      (name) => [name, () => {}],
    ),
  );
