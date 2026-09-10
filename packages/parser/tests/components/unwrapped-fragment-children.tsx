import { Children, type ReactNode } from "react";

/** Frames of a typing animation: each is the `Children.map` array of what has been typed so far. */
const frames = (children: ReactNode): ReactNode[][] => {
  const tokens = Children.map(children, (child) => child) ?? [];
  return tokens.map((_token, index) => tokens.slice(0, index + 1));
};

/** The hash decides the frame, so the fragment's array child is chosen at runtime. */
const Typist = ({ children }: { children: ReactNode }) => {
  const shown = frames(children);
  const frame = shown[window.location.hash === "#done" ? shown.length - 1 : 0];
  return <>{frame}</>;
};

/** A keyless fragment inside an unwrapped fragment stays a fiber; one inside its array too. */
const Nested = ({ children }: { children: ReactNode }) => (
  <>
    <>{children}</>
    {[<i key="dot">.</i>, <>{children}</>]}
  </>
);

export const isPartial = true;

export default function UnwrappedFragmentChildren() {
  return (
    <p>
      <Typist>
        <span>one</span>
        <span>two</span>
      </Typist>
      <Nested>
        <b>bold</b>
      </Nested>
    </p>
  );
}
