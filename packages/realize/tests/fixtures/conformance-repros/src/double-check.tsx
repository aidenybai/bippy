import { useState } from "react";

function callAll<Args extends Array<unknown>>(
  ...fns: Array<((...args: Args) => unknown) | undefined>
) {
  return (...args: Args) => fns.forEach((fn) => fn?.(...args));
}

function useDoubleCheck() {
  const [doubleCheck, setDoubleCheck] = useState(false);
  function getButtonProps(props?: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    const onClick = doubleCheck ? undefined : () => setDoubleCheck(true);
    return {
      ...props,
      onClick: callAll(onClick, props?.onClick),
      onBlur: callAll(() => setDoubleCheck(false), props?.onBlur),
    };
  }
  return { doubleCheck, getButtonProps };
}

export const DisableButton = () => {
  const dc = useDoubleCheck();
  return (
    <button {...dc.getButtonProps({ type: "submit" })}>
      {dc.doubleCheck ? "Are you sure?" : "Disable"}
    </button>
  );
};
