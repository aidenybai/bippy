import { useState } from "react";
import type { ReactNode } from "react";
import { styled } from "./name-collision-styled";

/**
 * Components are matched by declaration, not bare name: this `Row` is a styled wrapper,
 * unrelated to the `Row` in name-collision-table.tsx.
 */
const Row = styled("div");

export function NameCollision() {
  return <Row>settings</Row>;
}

/**
 * `useState()` holds `undefined`, which the harness must not report as `null`.
 */
export function UndefinedState({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState();
  const close = () => setOpenId(undefined);
  return (
    <section data-open={openId} onBlur={close}>
      {children}
    </section>
  );
}
