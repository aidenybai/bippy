import * as UI from "./ui";
import { BADGE_TEXT, Pill, PrimaryButton } from "./ui";
import { CycleA } from "./cycle-a";

export default function App() {
  return (
    <main>
      <UI.Button label="ns" />
      <UI.buttons.default label="deep-default" />
      <PrimaryButton label="primary" />
      <Pill text={BADGE_TEXT} />
      <CycleA depth={2} />
    </main>
  );
}
