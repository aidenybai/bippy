export interface ChangeDescription {
  context: boolean;
  didHooksChange: boolean;
  hooks: number[];
  isFirstMount: boolean;
  props: string[];
  state: string[] | null;
}

const getChangedKeys = (previous: unknown, next: unknown): string[] => {
  if (
    typeof previous !== "object" ||
    previous === null ||
    typeof next !== "object" ||
    next === null
  ) {
    return Object.is(previous, next) ? [] : ["value"];
  }
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  return [...keys].filter((key) => !Object.is(Reflect.get(previous, key), Reflect.get(next, key)));
};

export const getChangeDescription = (
  previousProps: unknown,
  nextProps: unknown,
  previousState: unknown,
  nextState: unknown,
  previousContext: unknown,
  nextContext: unknown,
  changedHooks: number[] = [],
): ChangeDescription => ({
  context: !Object.is(previousContext, nextContext),
  didHooksChange: changedHooks.length > 0,
  hooks: [...changedHooks],
  isFirstMount: false,
  props: getChangedKeys(previousProps, nextProps),
  state:
    previousState === undefined && nextState === undefined
      ? null
      : getChangedKeys(previousState, nextState),
});
