import { useFlag } from "flag-kit";

const Panel = () => <section>panel</section>;
const Toggle = () => <button type="button">toggle</button>;

export const App = () => {
  const isMounted = useFlag("compact");
  const transitionStatus = isMounted ? "entered" : "exited";
  const isHidden = transitionStatus === "exited";
  const shouldRenderPanel = !isHidden;
  return (
    <main>
      {shouldRenderPanel ? <Panel /> : null}
      {isHidden ? null : <Toggle />}
      {isHidden && <em>hidden</em>}
    </main>
  );
};
