import type { Fiber, FiberRoot, MemoizedState } from 'bippy';
import {
  ClassComponentTag,
  ForwardRefTag,
  FunctionComponentTag,
  MemoComponentTag,
  SimpleMemoComponentTag,
  _fiberRoots,
  getDisplayName,
  getNearestHostFibers,
  isCompositeFiber,
  instrument,
  shouldFilterFiber,
  traverseRenderedFibers,
} from 'bippy';

interface HookEntry {
  index: number;
  value: unknown;
}

interface ComponentData {
  boundingRect: DOMRect | null;
  children: string[];
  displayName: string;
  domDepth: number;
  fiberId: number;
  hooks: HookEntry[];
  isFrameworkInternal: boolean;
  props: Record<string, unknown>;
  state: Record<string, unknown> | null;
}

interface ScanResult {
  components: ComponentData[];
  timestamp: number;
  totalCount: number;
  userComponentCount: number;
}

type ScanListener = (result: ScanResult) => void;

let nextFiberId = 0;
const fiberIdMap = new WeakMap<Fiber, number>();

const getFiberScanId = (fiber: Fiber): number => {
  let id = fiberIdMap.get(fiber);
  if (id === undefined && fiber.alternate) {
    id = fiberIdMap.get(fiber.alternate);
  }
  if (id === undefined) {
    id = nextFiberId++;
    fiberIdMap.set(fiber, id);
  }
  return id;
};

const FRAMEWORK_NAME_PATTERNS = new Set([
  'Root',
  'ServerRoot',
  'ClientRoot',
  'AppRouter',
  'AppContainer',
  'AppDevOverlay',
  'Router',
  'ErrorBoundary',
  'ErrorBoundaryHandler',
  'SuspenseBoundary',
  'HotReload',
  'DevOverlay',
  'DevTools',
  'RuntimeStyles',
  'RuntimeError',
  'Layout',
  'RootLayout',
  'RedirectBoundary',
  'NotFoundBoundary',
  'LoadingBoundary',
  'InnerLayoutRender',
  'InnerStaticRender',
  'HeadManager',
  'MetaManager',
  'PathnameContextProvider',
  'RenderFromTemplateContext',
  'TemplateContext',
  'ScrollAndFocusHandler',
  'InnerScrollAndFocusHandler',
  'OuterLayout',
  'MaybePostpone',
  'HTTPAccessFallbackBoundary',
  'HTTPAccessFallbackErrorFallback',
  'MetadataOutlet',
  'ViewportMetadata',
  'Metadata',
  'Preloads',
  'StaticGenBailout',
  'BailoutError',
  'BuildtimeError',
  'PreloadCss',
  'PreloadStyle',
  'NextMark',
  'NextDevOverlay',
  'HistoryUpdater',
  'AppDevOverlayErrorBoundary',
  'ReplaySsrOnlyErrors',
  'DevRootHTTPAccessFallbackBoundary',
  'ReplayServerAction',
  'DevRootNotFoundBoundary',
  'DevRootRedirectBoundary',
  'RenderFrom',
]);

const FRAMEWORK_NAME_SUBSTRINGS = [
  'Provider',
  'Context',
  'Boundary',
  'Suspense',
  '_N_E',
];

const isFrameworkComponent = (_fiber: Fiber, displayName: string): boolean => {
  if (FRAMEWORK_NAME_PATTERNS.has(displayName)) {
    return true;
  }

  if (displayName.startsWith('$') || displayName.startsWith('_')) {
    return true;
  }

  if (FRAMEWORK_NAME_SUBSTRINGS.some((substring) => displayName.includes(substring))) {
    return true;
  }

  return false;
};

const extractHooks = (fiber: Fiber): HookEntry[] => {
  const hooks: HookEntry[] = [];
  const isFunctionLike =
    fiber.tag === FunctionComponentTag ||
    fiber.tag === SimpleMemoComponentTag ||
    fiber.tag === ForwardRefTag;

  if (!isFunctionLike) return hooks;

  let hookState: MemoizedState | null | undefined = fiber.memoizedState;
  let hookIndex = 0;

  while (hookState) {
    if (typeof hookState === 'object' && hookState !== null && 'memoizedState' in hookState) {
      const hookValue = hookState.memoizedState;
      if (hookValue !== undefined) {
        hooks.push({ index: hookIndex, value: safeSerialize(hookValue) });
      }
      hookState = hookState.next;
    } else {
      break;
    }
    hookIndex++;
  }

  return hooks;
};

const extractClassState = (fiber: Fiber): Record<string, unknown> | null => {
  if (fiber.tag !== ClassComponentTag) return null;
  const stateNode = fiber.stateNode;
  if (stateNode && typeof stateNode === 'object' && 'state' in stateNode) {
    return safeSerialize(stateNode.state) as Record<string, unknown>;
  }
  return safeSerialize(fiber.memoizedState) as Record<string, unknown>;
};

const safeSerialize = (value: unknown, depth = 0): unknown => {
  if (depth > 3) return '[max depth]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'function') {
    return `[Function: ${value.name || 'anonymous'}]`;
  }
  if (typeof value === 'symbol') {
    return value.toString();
  }
  if (value instanceof Element) {
    return `[DOM: ${value.tagName.toLowerCase()}]`;
  }
  if (Array.isArray(value)) {
    if (value.length > 10) {
      return [...value.slice(0, 10).map((item) => safeSerialize(item, depth + 1)), `...${value.length - 10} more`];
    }
    return value.map((item) => safeSerialize(item, depth + 1));
  }
  if (typeof value === 'object') {
    if ('$$typeof' in value) {
      const elementType = value as { type?: { name?: string; displayName?: string } | string };
      const typeName =
        typeof elementType.type === 'string'
          ? elementType.type
          : elementType.type?.displayName || elementType.type?.name || 'Unknown';
      return `[ReactElement: <${typeName} />]`;
    }
    const serialized: Record<string, unknown> = {};
    const entries = Object.entries(value);
    for (const [entryKey, entryValue] of entries.slice(0, 20)) {
      serialized[entryKey] = safeSerialize(entryValue, depth + 1);
    }
    if (entries.length > 20) {
      serialized['...'] = `${entries.length - 20} more keys`;
    }
    return serialized;
  }
  return String(value);
};

const getBoundingRect = (fiber: Fiber): DOMRect | null => {
  const hostFibers = getNearestHostFibers(fiber);
  if (hostFibers.length === 0) return null;

  let minLeft = Infinity;
  let minTop = Infinity;
  let maxRight = -Infinity;
  let maxBottom = -Infinity;

  for (const hostFiber of hostFibers) {
    const domNode = hostFiber.stateNode;
    if (domNode instanceof Element) {
      const rect = domNode.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      minLeft = Math.min(minLeft, rect.left);
      minTop = Math.min(minTop, rect.top);
      maxRight = Math.max(maxRight, rect.right);
      maxBottom = Math.max(maxBottom, rect.bottom);
    }
  }

  if (minLeft === Infinity) return null;

  return new DOMRect(minLeft, minTop, maxRight - minLeft, maxBottom - minTop);
};

const getDomDepth = (fiber: Fiber): number => {
  let depth = 0;
  let current: Fiber | null = fiber.return;
  while (current) {
    if (isCompositeFiber(current) && !shouldFilterFiber(current)) {
      depth++;
    }
    current = current.return;
  }
  return depth;
};

const getChildComponentNames = (fiber: Fiber): string[] => {
  const childNames: string[] = [];
  let child: Fiber | null = fiber.child;

  while (child) {
    if (isCompositeFiber(child) && !shouldFilterFiber(child)) {
      const name = getDisplayName(child.type);
      if (name) childNames.push(name);
    }
    child = child.sibling;
  }

  return childNames;
};

const sanitizeProps = (memoizedProps: Record<string, unknown>): Record<string, unknown> => {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(memoizedProps)) {
    if (key === 'children') continue;
    sanitized[key] = safeSerialize(value);
  }
  return sanitized;
};

const scanFiberTree = (root: FiberRoot): ComponentData[] => {
  const components: ComponentData[] = [];
  const rootFiber = root.current;
  if (!rootFiber) return components;

  const visitedFibers = new WeakSet<Fiber>();

  const walkFiber = (fiber: Fiber | null): void => {
    if (!fiber) return;

    if (visitedFibers.has(fiber)) return;
    visitedFibers.add(fiber);

    if (isCompositeFiber(fiber) && !shouldFilterFiber(fiber)) {
      const displayName = getDisplayName(fiber.type);
      if (displayName) {
        const isInternal = isFrameworkComponent(fiber, displayName);
        components.push({
          boundingRect: getBoundingRect(fiber),
          children: getChildComponentNames(fiber),
          displayName,
          domDepth: getDomDepth(fiber),
          fiberId: getFiberScanId(fiber),
          hooks: extractHooks(fiber),
          isFrameworkInternal: isInternal,
          props: sanitizeProps(fiber.memoizedProps || {}),
          state: extractClassState(fiber),
        });
      }
    }

    walkFiber(fiber.child);
    walkFiber(fiber.sibling);
  };

  walkFiber(rootFiber.child);
  return components;
};

const scanAllRoots = (): ScanResult => {
  const allComponents: ComponentData[] = [];

  for (const root of _fiberRoots) {
    const components = scanFiberTree(root);
    allComponents.push(...components);
  }

  const userComponentCount = allComponents.filter(
    (component) => !component.isFrameworkInternal,
  ).length;

  return {
    components: allComponents,
    timestamp: Date.now(),
    totalCount: allComponents.length,
    userComponentCount,
  };
};

const listeners = new Set<ScanListener>();
let isInstrumented = false;
let isNotifying = false;
let pendingNotification: ReturnType<typeof setTimeout> | null = null;

const notifyListeners = (): void => {
  if (isNotifying) return;
  if (pendingNotification !== null) return;

  pendingNotification = setTimeout(() => {
    pendingNotification = null;
    isNotifying = true;
    try {
      const result = scanAllRoots();
      for (const listener of listeners) {
        listener(result);
      }
    } finally {
      isNotifying = false;
    }
  }, 16);
};

const setupInstrumentation = (): void => {
  if (isInstrumented) return;
  isInstrumented = true;

  instrument({
    onCommitFiberRoot: (_rendererID, root) => {
      if (!_fiberRoots.has(root)) {
        _fiberRoots.add(root);
      }

      traverseRenderedFibers(root, () => {});
      notifyListeners();
    },
  });
};

const scan = (): ScanResult => {
  setupInstrumentation();
  return scanAllRoots();
};

const subscribe = (listener: ScanListener): (() => void) => {
  setupInstrumentation();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export type { ComponentData, HookEntry, ScanListener, ScanResult };
export { scan, scanAllRoots, setupInstrumentation, subscribe };
