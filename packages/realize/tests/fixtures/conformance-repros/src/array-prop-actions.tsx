import { useState } from "react";
import type { ReactNode } from "react";

const Modal = ({ actions, children }: { actions: ReactNode[]; children: ReactNode }) => (
  <section>
    {children}
    <footer>{actions}</footer>
  </section>
);

export const ShareDialog = () => {
  const [isOpen, setIsOpen] = useState(true);
  if (!isOpen)
    return (
      <button type="button" onClick={() => setIsOpen(true)}>
        Share
      </button>
    );
  return (
    <Modal
      actions={[
        <button key="copy" type="button" onClick={() => setIsOpen(false)}>
          Copy
        </button>,
      ]}
    >
      <p>Link ready</p>
    </Modal>
  );
};
