"use client";

import {
  Component,
  memo,
  useState,
  useContext,
  useSyncExternalStore,
  createContext,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import * as stylex from "@stylexjs/stylex";
import { Button } from "../../../components/ui/button";
import { colors } from "../../../diagram/tokens.stylex";

interface ExampleProps {
  children: ReactNode;
}
interface BoundaryState {
  hasError: boolean;
}
interface ExampleOptions {
  label: string;
}
interface MemoValueProps {
  count: number;
  options: ExampleOptions;
  onOptions: Dispatch<SetStateAction<ExampleOptions>>;
}
const ExampleContext = createContext<ExampleOptions | null>(null);
const storeSnapshot = { label: "private-store-sentinel" };
const getSnapshot = () => storeSnapshot;
const subscribe = () => () => undefined;
const ContextReader = () => {
  const options = useContext(ExampleContext);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return (
    <output aria-label="Context example">
      {options?.label}
      {snapshot.label}
    </output>
  );
};

const styles = stylex.create({
  main: {
    padding: 32,
    color: colors.text,
    backgroundColor: colors.surface,
    fontFamily: "system-ui, sans-serif",
  },
  actions: { display: "flex", gap: 8, marginBlock: 16 },
});

class ExampleBoundary extends Component<ExampleProps, BoundaryState> {
  state = { hasError: false };
  static getDerivedStateFromError = () => ({ hasError: true });
  render = () => (this.state.hasError ? <p>Example failed</p> : this.props.children);
}

const ExampleLayout = ({ children }: ExampleProps) => <section>{children}</section>;
const MemoValue = memo(({ count, options, onOptions }: MemoValueProps) => (
  <output
    aria-label="Example count"
    data-reference={options.label}
    onClick={() => onOptions(options)}
  >
    {count}
  </output>
));
MemoValue.displayName = "MemoValue";
const ConditionalLeaf = () => <p>Private text is not part of the capture.</p>;
const PortalContent = () => <aside aria-label="Example portal">Portal content</aside>;

const CaptureExample = () => {
  const [count, setCount] = useState(0);
  const [options, setOptions] = useState({ label: "private-reference-sentinel" });
  const [isVisible, setIsVisible] = useState(true);
  const [isPortalOpen, setIsPortalOpen] = useState(false);
  return (
    <main {...stylex.props(styles.main)}>
      <h1>Capture example</h1>
      <ExampleBoundary>
        <ExampleLayout>
          <MemoValue count={count} options={options} onOptions={setOptions} />
        </ExampleLayout>
        <div {...stylex.props(styles.actions)}>
          <Button onClick={() => setCount((value) => value + 1)}>Increment</Button>
          <Button onClick={() => setIsVisible((value) => !value)}>Toggle leaf</Button>
          <Button onClick={() => setIsPortalOpen((value) => !value)}>Toggle portal</Button>
        </div>
        <ExampleContext value={options}>
          <ContextReader />
        </ExampleContext>
        {isVisible && <ConditionalLeaf />}
        {isPortalOpen && createPortal(<PortalContent />, document.body)}
        <input aria-label="Private input" defaultValue="private-value-sentinel" />
      </ExampleBoundary>
    </main>
  );
};

export default CaptureExample;
