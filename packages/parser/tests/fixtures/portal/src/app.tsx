import { createPortal } from "react-dom";

const Modal = ({ children }: { children: string }) =>
  createPortal(<dialog open>{children}</dialog>, document.getElementById("portal-target")!);

export const App = () => (
  <div>
    <p>page</p>
    <Modal>hello</Modal>
  </div>
);
