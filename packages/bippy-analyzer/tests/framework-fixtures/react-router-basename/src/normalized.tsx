import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, useLocation } from "react-router";

const LocationIdentity = () => {
  const location = useLocation();
  const first = useRef(location);
  return first.current === location ? <strong /> : <em />;
};

const App = () => {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <BrowserRouter basename={ready ? "/" : undefined}>
      <LocationIdentity />
    </BrowserRouter>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
