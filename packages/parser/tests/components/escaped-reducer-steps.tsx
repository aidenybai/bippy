import { useLayoutEffect, useReducer } from "react";

const useClosedFlag = () => {
  const [isClosed, dispatch] = useReducer((current: boolean, next: boolean) => next, false);
  useLayoutEffect(() => {
    const handleTransition = () => dispatch(true);
    window.addEventListener("transitionend", handleTransition);
    return () => window.removeEventListener("transitionend", handleTransition);
  }, []);
  return isClosed;
};

/** A dispatch that keeps changing the state has no settled value. */
const useAnimationTicks = () => {
  const [ticks, dispatch] = useReducer((current: number, step: number) => current + step, 0);
  useLayoutEffect(() => {
    const handleIteration = () => dispatch(1);
    window.addEventListener("animationiteration", handleIteration);
    return () => window.removeEventListener("animationiteration", handleIteration);
  }, []);
  return ticks;
};

const Ticks = () => {
  const ticks = useAnimationTicks();
  const isClosed = useClosedFlag();
  return <p data-closed={isClosed}>{ticks > 0 ? <strong>{ticks}</strong> : <em>none</em>}</p>;
};

export const isPartial = true;

export default function EscapedReducerSteps() {
  return <Ticks />;
}
