import type { HookKind } from "../../react-compiler/HIR/ObjectShape";

interface HookTraits {
  slot: "state" | "reducer" | null;
  isEffect: boolean;
  callsPropsOnlyInEvents: boolean;
  heldArgumentIndices: number[];
}

const DEFAULT_TRAITS: HookTraits = {
  slot: null,
  isEffect: false,
  callsPropsOnlyInEvents: true,
  heldArgumentIndices: [],
};

const EFFECT_TRAITS: HookTraits = {
  ...DEFAULT_TRAITS,
  isEffect: true,
  callsPropsOnlyInEvents: false,
};

const HOOK_TRAITS = {
  useContext: DEFAULT_TRAITS,
  useState: { ...DEFAULT_TRAITS, slot: "state", heldArgumentIndices: [0] },
  useActionState: { ...DEFAULT_TRAITS, slot: "reducer" },
  useReducer: { ...DEFAULT_TRAITS, slot: "reducer", heldArgumentIndices: [1, 2] },
  useRef: { ...DEFAULT_TRAITS, heldArgumentIndices: [0] },
  useEffect: EFFECT_TRAITS,
  useLayoutEffect: EFFECT_TRAITS,
  useInsertionEffect: EFFECT_TRAITS,
  useMemo: DEFAULT_TRAITS,
  useCallback: DEFAULT_TRAITS,
  useTransition: DEFAULT_TRAITS,
  useImperativeHandle: { ...DEFAULT_TRAITS, callsPropsOnlyInEvents: false },
  useEffectEvent: { ...DEFAULT_TRAITS, callsPropsOnlyInEvents: false },
  useOptimistic: { ...DEFAULT_TRAITS, slot: "state" },
  Custom: { ...DEFAULT_TRAITS, callsPropsOnlyInEvents: false, heldArgumentIndices: [0, 1, 2, 3] },
} satisfies Record<HookKind, HookTraits>;

export const getHookTraits = (hookKind: HookKind): HookTraits => HOOK_TRAITS[hookKind];
