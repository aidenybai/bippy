import type { ReactNode } from "react";
import { useState } from "react";

const Dialog = ({ actions, children }: { actions: ReactNode[]; children: ReactNode }) => (
  <section>
    {children}
    <footer>{actions}</footer>
  </section>
);

export const ShareDialog = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  return (
    <div>
      <button onClick={() => setIsOpen(true)}>share</button>
      {isOpen && (
        <Dialog
          actions={[
            <button key="copy" onClick={() => setIsCopied(true)}>
              copy
            </button>,
            <button key="close" onClick={() => setIsOpen(false)}>
              close
            </button>,
          ]}
        >
          <p>{isCopied ? "copied" : "link"}</p>
        </Dialog>
      )}
    </div>
  );
};
