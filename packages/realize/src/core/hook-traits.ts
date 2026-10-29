import type { HookKind } from "../react-compiler/HIR/ObjectShape";

interface HookTraits {
  slot: "state" | "reducer" | null;
  isEffect: boolean;
  callsPropsOnlyInEvents: boolean;
  heldArgumentIndices: number[];
}

const HOOK_TRAITS = {
  useContext: {
    slot: null,
    isEffect: false,
    callsPropsOnlyInEvents: true,
    heldArgumentIndices: [],
  },
  useState: {
    slot: "state",
    isEffect: false,
    callsPropsOnlyInEvents: true,
    heldArgumentIndices: [0],
  },
  useActionState: {
    slot: "reducer",
    isEffect: false,
    callsPropsOnlyInEvents: true,
    heldArgumentIndices: [],
  },
  useReducer: {
    slot: "reducer",
    isEffect: false,
    callsPropsOnlyInEvents: true,
    heldArgumentIndices: [1, 2],
  },
  useRef: { slot: null, isEffect: false, callsPropsOnlyInEvents: true, heldArgumentIndices: [0] },
  useEffect: { slot: null, isEffect: true, callsPropsOnlyInEvents: false, heldArgumentIndices: [] },
  useLayoutEffect: {
    slot: null,
    isEffect: true,
    callsPropsOnlyInEvents: false,
    heldArgumentIndices: [],
  },
  useInsertionEffect: {
    slot: null,
    isEffect: true,
    callsPropsOnlyInEvents: false,
    heldArgumentIndices: [],
  },
  useMemo: { slot: null, isEffect: false, callsPropsOnlyInEvents: true, heldArgumentIndices: [] },
  useCallback: {
    slot: null,
    isEffect: false,
    callsPropsOnlyInEvents: true,
    heldArgumentIndices: [],
  },
  useTransition: {
    slot: null,
    isEffect: false,
    callsPropsOnlyInEvents: true,
    heldArgumentIndices: [],
  },
  useImperativeHandle: {
    slot: null,
    isEffect: false,
    callsPropsOnlyInEvents: false,
    heldArgumentIndices: [],
  },
  useEffectEvent: {
    slot: null,
    isEffect: false,
    callsPropsOnlyInEvents: false,
    heldArgumentIndices: [],
  },
  useOptimistic: {
    slot: "state",
    isEffect: false,
    callsPropsOnlyInEvents: true,
    heldArgumentIndices: [],
  },
  Custom: {
    slot: null,
    isEffect: false,
    callsPropsOnlyInEvents: false,
    heldArgumentIndices: [0, 1, 2, 3],
  },
} satisfies Record<HookKind, HookTraits>;

export const getHookTraits = (hookKind: HookKind): HookTraits => HOOK_TRAITS[hookKind];
