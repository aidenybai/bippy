import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const Notice = ({ children }: { children: string }) => (
  <aside>
    <p>{children}</p>
  </aside>
);

export const unsupported = () => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Notice>Your browser is not supported</Notice>
    </StrictMode>,
  );
};
