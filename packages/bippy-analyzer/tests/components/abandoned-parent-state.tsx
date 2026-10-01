import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface PhaseProps {
  phase: number;
}

interface ParentProps extends PhaseProps {
  label: string;
  children: ReactNode;
  acceptsCleanup?: boolean;
  acceptsDeferred?: boolean;
  acceptsNoop?: boolean;
}

interface MemoValue {
  phase: number;
}

interface UpdateValue {
  (value: number): void;
}

const shouldPrequeueNoop = Boolean(document.createElement("canvas").getContext("2d"));
const trace: string[] = [];
const pending = new Promise<void>(() => {});
let updateQueued: UpdateValue | null = null;
let updateDeferred: UpdateValue | null = null;
let updateNoop: UpdateValue | null = null;
let dispatchReducer: UpdateValue | null = null;

const Pause = ({ phase }: PhaseProps) => {
  if (phase === 1) throw pending;
  return <span>ready</span>;
};

const Parent = ({
  phase,
  label,
  children,
  acceptsCleanup,
  acceptsDeferred,
  acceptsNoop,
}: ParentProps) => {
  const [value, setValue] = useState(0);
  const shared = useRef({ touched: false });
  const committedMemo = useRef<MemoValue | null>(null);
  const memo = useMemo(() => ({ phase }), [phase]);
  useLayoutEffect(() => {
    if (acceptsCleanup) updateQueued = setValue;
    if (acceptsDeferred) updateDeferred = setValue;
    if (acceptsNoop) updateNoop = setValue;
    committedMemo.current ??= memo;
    trace.push(`${label}:${value}:${memo === committedMemo.current}:${shared.current.touched}`);
  }, [memo, value]);
  if (phase === 1) {
    shared.current.touched = true;
    if (value === 0) setValue(1);
  }
  return children;
};

const ReducerTail = ({ phase }: PhaseProps) => {
  const [value, dispatch] = useReducer((current: number, amount: number) => current + amount, 0);
  useLayoutEffect(() => {
    dispatchReducer = dispatch;
    trace.push(`reducer:${value}`);
  }, [value]);
  if (phase === 1 && value === 2) dispatch(1);
  return <span>{value}</span>;
};

const CleanupSibling = () => {
  useLayoutEffect(() => () => updateQueued?.(3), []);
  return <span>cleanup sibling</span>;
};

export const isExact = true;

export default () => {
  const [phase, setPhase] = useState(0);
  const [snapshot, setSnapshot] = useState("");
  useLayoutEffect(() => {
    if (phase === 0) {
      dispatchReducer?.(2);
      setPhase(1);
    }
  }, [phase]);
  useEffect(() => {
    if (phase === 1)
      setTimeout(() => {
        updateDeferred?.(5);
        if (shouldPrequeueNoop) updateNoop?.(1);
        updateNoop?.(1);
        dispatchReducer?.(4);
        setPhase(2);
      }, 0);
    if (phase === 2) setSnapshot(trace.join("|"));
  }, [phase]);
  const childPhase = phase === 2 ? 0 : phase;
  return (
    <main>
      <Suspense fallback={<i>loading</i>}>
        <Parent phase={childPhase} label="basic">
          <Pause phase={childPhase} />
        </Parent>
      </Suspense>
      <Parent phase={childPhase} label="outside">
        <Suspense fallback={<i>inner fallback</i>}>
          <Pause phase={childPhase} />
        </Suspense>
      </Parent>
      <Suspense fallback={<i>outer fallback</i>}>
        <Suspense fallback={<i>sibling fallback</i>}>
          <Parent phase={childPhase} label="sibling">
            <span>sibling</span>
          </Parent>
        </Suspense>
        <Pause phase={childPhase} />
        <Parent phase={childPhase} label="tail">
          <span>tail sibling</span>
        </Parent>
        <Parent phase={childPhase} label="deferred" acceptsDeferred>
          <span>deferred sibling</span>
        </Parent>
        <Parent phase={childPhase} label="noop" acceptsNoop>
          <span>no-op sibling</span>
        </Parent>
        <ReducerTail phase={childPhase} />
      </Suspense>
      <Suspense fallback={<i>queued fallback</i>}>
        <CleanupSibling />
        <Parent phase={childPhase} label="queued" acceptsCleanup>
          <Pause phase={childPhase} />
        </Parent>
      </Suspense>
      <p>
        {"trace:"}
        {snapshot}
      </p>
    </main>
  );
};
