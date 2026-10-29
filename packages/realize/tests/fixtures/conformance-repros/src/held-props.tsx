import { forwardRef, memo, useCallback, useImperativeHandle, useRef, useState } from "react";

interface Handle {
  run: () => void;
}

interface StepProps {
  onStep: () => void;
}

const ComparedStep = memo(
  ({ onStep }: StepProps) => <button onClick={onStep}>step</button>,
  () => true,
);

const HandleStep = forwardRef<Handle, StepProps>(({ onStep }, ref) => {
  useImperativeHandle(ref, () => ({ run: onStep }), []);
  return <i>handle</i>;
});

const FreshStep = forwardRef<Handle, StepProps>(({ onStep }, ref) => {
  useImperativeHandle(ref, () => ({ run: onStep }), [onStep]);
  return <i>handle</i>;
});

const CallbackStep = ({ onStep }: StepProps) => {
  const run = useCallback(() => onStep(), []);
  return <button onClick={run}>step</button>;
};

const RefStep = ({ onStep }: StepProps) => {
  const first = useRef(onStep);
  return <button onClick={() => first.current()}>step</button>;
};

const StateStep = ({ onStep }: StepProps) => {
  const [first] = useState(() => onStep);
  return <button onClick={first}>step</button>;
};

const InnerStep = ({ onStep }: StepProps) => <button onClick={onStep}>step</button>;

const NamedStep = memo(InnerStep, () => true);

const ForwardingStep = ({ onStep }: StepProps) => <RefStep onStep={onStep} />;

export const HeldCompare = () => {
  const [n, setN] = useState(0);
  return (
    <div>
      {n === 1 ? <b>one</b> : <s>one</s>}
      {n >= 2 ? <b>many</b> : <s>many</s>}
      <ComparedStep onStep={() => setN(n + 1)} />
      <button onClick={() => setN(n + 2)}>two</button>
    </div>
  );
};

export const HeldHandle = () => {
  const [n, setN] = useState(0);
  const handle = useRef<Handle>(null);
  return (
    <div>
      {n === 1 ? <b>one</b> : <s>one</s>}
      {n >= 2 ? <b>many</b> : <s>many</s>}
      <HandleStep ref={handle} onStep={() => setN(n + 1)} />
      <button onClick={() => handle.current?.run()}>run</button>
      <button onClick={() => setN(n + 2)}>two</button>
    </div>
  );
};

export const FreshHandle = () => {
  const [n, setN] = useState(0);
  const handle = useRef<Handle>(null);
  return (
    <div>
      {n === 1 ? <b>one</b> : <s>one</s>}
      {n >= 2 ? <b>many</b> : <s>many</s>}
      <FreshStep ref={handle} onStep={() => setN(n + 1)} />
      <button onClick={() => handle.current?.run()}>run</button>
      <button onClick={() => setN(n + 2)}>two</button>
    </div>
  );
};

export const HeldCallback = () => {
  const [n, setN] = useState(0);
  return (
    <div>
      {n === 1 ? <b>one</b> : <s>one</s>}
      {n >= 2 ? <b>many</b> : <s>many</s>}
      <CallbackStep onStep={() => setN(n + 1)} />
      <button onClick={() => setN(n + 2)}>two</button>
    </div>
  );
};

export const HeldRef = () => {
  const [n, setN] = useState(0);
  return (
    <div>
      {n === 1 ? <b>one</b> : <s>one</s>}
      {n >= 2 ? <b>many</b> : <s>many</s>}
      <RefStep onStep={() => setN(n + 1)} />
      <button onClick={() => setN(n + 2)}>two</button>
    </div>
  );
};

export const HeldState = () => {
  const [n, setN] = useState(0);
  return (
    <div>
      {n === 1 ? <b>one</b> : <s>one</s>}
      {n >= 2 ? <b>many</b> : <s>many</s>}
      <StateStep onStep={() => setN(n + 1)} />
      <button onClick={() => setN(n + 2)}>two</button>
    </div>
  );
};

export const HeldNamed = () => {
  const [n, setN] = useState(0);
  return (
    <div>
      {n === 1 ? <b>one</b> : <s>one</s>}
      {n >= 2 ? <b>many</b> : <s>many</s>}
      <NamedStep onStep={() => setN(n + 1)} />
      <button onClick={() => setN(n + 2)}>two</button>
    </div>
  );
};

export const HeldForwarded = () => {
  const [n, setN] = useState(0);
  return (
    <div>
      {n === 1 ? <b>one</b> : <s>one</s>}
      {n >= 2 ? <b>many</b> : <s>many</s>}
      <ForwardingStep onStep={() => setN(n + 1)} />
      <button onClick={() => setN(n + 2)}>two</button>
    </div>
  );
};
