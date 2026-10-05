import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, useLocation } from "react-router";

const LocationIdentity = () => {
  const location = useLocation();
  const first = useRef(location);
  return (
    <main>
      {location.pathname}
      <i />
      {first.current === location ? <strong /> : <em />}
    </main>
  );
};

const App = () => {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (phase < 2) setPhase(phase + 1);
  }, [phase]);
  return (
    <BrowserRouter basename={phase === 1 ? "/app/items/" : "/app/"}>
      <LocationIdentity />
    </BrowserRouter>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
