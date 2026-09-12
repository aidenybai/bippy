import { useEffect, useRef, useState } from "react";

const Choice = () => {
  const renders = useRef(0);
  renders.current++;
  return Math.random() > 0.5 ? (
    <section>
      {"renders:"}
      {renders.current}
    </section>
  ) : (
    <aside>
      {"renders:"}
      {renders.current}
    </aside>
  );
};
const sharedChoice = <Choice />;

const App = () => {
  const [hasExtraChoice, setHasExtraChoice] = useState(false);
  useEffect(() => setHasExtraChoice(true), []);
  return (
    <main>
      {sharedChoice}
      {sharedChoice}
      {hasExtraChoice ? <Choice /> : null}
    </main>
  );
};

export default App;
