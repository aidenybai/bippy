import * as React from "react";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const useLayoutEffect = globalThis?.document ? React.useLayoutEffect : () => {};

const HiddenContent = ({ children, isOpen }: { children: ReactNode; isOpen: boolean }) => {
  const [fragment, setFragment] = useState<DocumentFragment>();
  useLayoutEffect(() => {
    setFragment(new DocumentFragment());
  }, []);
  if (!isOpen) {
    return fragment ? createPortal(<div>{children}</div>, fragment) : null;
  }
  return <section>{children}</section>;
};

export default function FragmentPortalState() {
  return (
    <main>
      <HiddenContent isOpen={false}>
        <span>hidden option</span>
      </HiddenContent>
      <HiddenContent isOpen>
        <span>visible option</span>
      </HiddenContent>
    </main>
  );
}
