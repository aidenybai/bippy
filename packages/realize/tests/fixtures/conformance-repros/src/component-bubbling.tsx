import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

const GoButton = ({ onGo }: { onGo: () => void }) => <button onClick={onGo}>go</button>;

const Panel = ({ onPress, children }: { onPress: () => void; children: ReactNode }) => (
  <section onClick={onPress}>{children}</section>
);

export const ChildButtonInDiv = () => {
  const [isInner, setIsInner] = useState(false);
  const [isOuter, setIsOuter] = useState(false);
  return (
    <div onClick={() => setIsOuter(true)}>
      <GoButton onGo={() => setIsInner(true)} />
      {isInner && isOuter ? <i>both</i> : <i>apart</i>}
    </div>
  );
};

export const ButtonInChildPanel = () => {
  const [isInner, setIsInner] = useState(false);
  const [isOuter, setIsOuter] = useState(false);
  return (
    <Panel onPress={() => setIsOuter(true)}>
      <button onClick={() => setIsInner(true)}>go</button>
      {isInner && isOuter ? <i>both</i> : <i>apart</i>}
    </Panel>
  );
};

const GoContext = createContext(() => {});

const GoConsumer = () => {
  const go = useContext(GoContext);
  return <button onClick={go}>go</button>;
};

export const ConsumerInDiv = () => {
  const [isInner, setIsInner] = useState(false);
  const [isOuter, setIsOuter] = useState(false);
  return (
    <GoContext.Provider value={() => setIsInner(true)}>
      <div onClick={() => setIsOuter(true)}>
        <GoConsumer />
      </div>
      {isInner && isOuter ? <i>both</i> : <i>apart</i>}
    </GoContext.Provider>
  );
};
