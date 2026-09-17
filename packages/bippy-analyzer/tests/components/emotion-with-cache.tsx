import { withEmotionCache } from "@emotion/react";
import {
  createContext,
  forwardRef,
  useContext,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type Ref,
} from "react";

// A styled factory built directly on `withEmotionCache` (Chakra's `chakra()`
// factory, Emotion's own `styled`): the render receives `(props, cache, ref)`,
// keeps its hooks, and forwards the ref to the tag it renders, so a provider
// component wrapped this way still provides to the children it receives.

interface ToggleContextValue {
  isOn: boolean;
  toggle: () => void;
}

const ToggleContext = createContext<ToggleContextValue | null>(null);

const useToggle = (): ToggleContextValue => {
  const value = useContext(ToggleContext);
  if (!value) throw new Error("useToggle outside <ToggleRoot>");
  return value;
};

const ToggleRoot = forwardRef<HTMLLabelElement, { children: ReactNode; className?: string }>(
  function ToggleRoot({ children, className }, ref) {
    const [isOn, setIsOn] = useState(false);
    const value = useMemo(() => ({ isOn, toggle: () => setIsOn((on) => !on) }), [isOn]);
    return (
      <ToggleContext.Provider value={value}>
        <label ref={ref} className={className}>
          {children}
        </label>
      </ToggleContext.Provider>
    );
  },
);

const ToggleIndicator = () => {
  const { isOn } = useToggle();
  return <span data-state={isOn ? "on" : "off"}>{isOn ? "on" : "off"}</span>;
};

interface StyledProps {
  children?: ReactNode;
  className?: string;
  tone?: string;
}

const styledWithCache = (Tag: ComponentType<StyledProps> | "div", label: string) =>
  withEmotionCache((props: StyledProps, cache, ref: Ref<unknown>) => {
    const renders = useRef(0);
    renders.current += 1;
    const forwarded = useMemo(() => {
      const { tone: _tone, ...rest } = props;
      return rest;
    }, [props]);
    const className = [props.className, `${label}-${cache.key}`].filter(Boolean).join(" ");
    return (
      <>
        <Tag {...forwarded} className={className} ref={ref} />
        <i>{renders.current}</i>
      </>
    );
  });

const Root = styledWithCache(ToggleRoot, "root");
const Box = styledWithCache("div", "box");

export default function EmotionWithCache() {
  const rootRef = useRef<HTMLLabelElement>(null);
  return (
    <Box tone="muted">
      <Root ref={rootRef} tone="loud">
        <ToggleIndicator />
      </Root>
    </Box>
  );
}
