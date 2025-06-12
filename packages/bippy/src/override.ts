import type { ReactRenderer } from './types.js';
import { hasRDTHook, getRDTHook } from './rdt-hook.js';
import type { Fiber } from './types.js';

let _overrideProps: ReactRenderer['overrideProps'] | null = null;
let _overrideHookState: ReactRenderer['overrideHookState'] | null = null;
let _overrideContext: ReactRenderer['overrideContext'] | null = null;

export const injectOverrideMethods = () => {
  if (!hasRDTHook()) return null;
  const rdtHook = getRDTHook();
  if (!rdtHook?.renderers) return null;

  if (_overrideProps || _overrideHookState || _overrideContext) {
    return {
      overrideProps: _overrideProps,
      overrideHookState: _overrideHookState,
      overrideContext: _overrideContext,
    };
  }

  for (const [_, renderer] of Array.from(rdtHook.renderers)) {
    try {
      if (_overrideHookState) {
        const prevOverrideHookState = _overrideHookState;
        _overrideHookState = (
          fiber: Fiber,
          id: string,
          path: string[],
          value: unknown
        ) => {
          let current = fiber.memoizedState;
          for (let i = 0; i < Number(id); i++) {
            if (!current?.next) break;
            current = current.next;
          }

          if (current?.queue) {
            const queue = current.queue;
            if (isPOJO(queue) && 'dispatch' in queue) {
              const dispatch = queue.dispatch as (value: unknown) => void;
              dispatch(value);
              return;
            }
          }

          prevOverrideHookState(fiber, id, path, value);
          renderer.overrideHookState?.(fiber, id, path, value);
        };
      } else if (renderer.overrideHookState) {
        _overrideHookState = renderer.overrideHookState;
      }

      if (_overrideProps) {
        const prevOverrideProps = _overrideProps;
        _overrideProps = (
          fiber: Fiber,
          path: Array<string>,
          value: unknown
        ) => {
          prevOverrideProps(fiber, path, value);
          renderer.overrideProps?.(fiber, path, value);
        };
      } else if (renderer.overrideProps) {
        _overrideProps = renderer.overrideProps;
      }

      _overrideContext = (
        fiber: Fiber,
        contextType: unknown,
        path: string[],
        value: unknown
      ) => {
        let current: Fiber | null = fiber;
        while (current) {
          const type = current.type as { Provider?: unknown };
          if (type === contextType || type?.Provider === contextType) {
            if (_overrideProps) {
              _overrideProps(current, ['value', ...path], value);
              if (current.alternate) {
                _overrideProps(current.alternate, ['value', ...path], value);
              }
            }
            break;
          }
          current = current.return;
        }
      };
    } catch {
      /**/
    }
  }
};

const isPOJO = (maybePOJO: unknown): maybePOJO is Record<string, unknown> => {
  return (
    Object.prototype.toString.call(maybePOJO) === '[object Object]' &&
    (Object.getPrototypeOf(maybePOJO) === Object.prototype ||
      Object.getPrototypeOf(maybePOJO) === null)
  );
};

const buildPathsFromValue = (
  maybePOJO: Record<string, unknown> | unknown,
  basePath: string[] = []
): Array<{ path: string[]; value: unknown }> => {
  if (!isPOJO(maybePOJO)) {
    return [{ path: basePath, value: maybePOJO }];
  }

  const paths: Array<{ path: string[]; value: unknown }> = [];

  for (const key in maybePOJO) {
    const value = maybePOJO[key];
    const path = basePath.concat(key);

    if (isPOJO(value)) {
      paths.push(...buildPathsFromValue(value, path));
    } else {
      paths.push({ path, value });
    }
  }

  return paths;
};

export const overrideProps = (
  fiber: Fiber,
  partialValue: Record<string, unknown>
) => {
  injectOverrideMethods();

  const paths = buildPathsFromValue(partialValue);

  for (const { path, value } of paths) {
    try {
      _overrideProps?.(fiber, path, value);
    } catch {}
  }
};

export const overrideHookState = (
  fiber: Fiber,
  id: number,
  partialValue: Record<string, unknown> | unknown
) => {
  injectOverrideMethods();

  const hookId = String(id);

  if (isPOJO(partialValue)) {
    const paths = buildPathsFromValue(partialValue);

    for (const { path, value } of paths) {
      try {
        _overrideHookState?.(fiber, hookId, path, value);
      } catch {}
    }
  } else {
    try {
      _overrideHookState?.(fiber, hookId, [], partialValue);
    } catch {}
  }
};

export const overrideContext = (
  fiber: Fiber,
  contextType: unknown,
  partialValue: Record<string, unknown> | unknown
) => {
  injectOverrideMethods();

  if (isPOJO(partialValue)) {
    const paths = buildPathsFromValue(partialValue);

    for (const { path, value } of paths) {
      try {
        _overrideContext?.(fiber, contextType, path, value);
      } catch {}
    }
  } else {
    try {
      _overrideContext?.(fiber, contextType, [], partialValue);
    } catch {}
  }
};
