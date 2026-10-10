import { useState } from "react";
import type { ReactNode } from "react";
import { styled } from "./name-collision-styled";

/**
 * False "wrong state" from the verifier (wild-oasis CheckoutButton, Settings,
 * Bookings, Uploader: 17 of its 18 wrong claims).
 *
 * `Row` here is a styled-components wrapper whose runtime display name is
 * "styled.div". The analyzer doesn't analyze it, so `<Row>` should be an unknown
 * component that matches any fiber. But tests/verify/verify.ts builds
 * `knownComponents` keyed by bare component name, and name-collision-table.tsx
 * has an unrelated `function Row`, so the verifier expects a fiber named "Row"
 * and rejects the real "styled.div" one.
 */
const Row = styled("div");

export function NameCollision() {
  return <Row>settings</Row>;
}

/**
 * False "wrong value" (wild-oasis Menus): `useState()` holds `undefined`, but the
 * browser harness serializes hook state with toPlain, which maps undefined to
 * null (tests/verify/browser-entry.ts:92), so the predicted `undefined` is
 * reported as wrong.
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
