import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { Counter, Page } from "./page";

const App = () => {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <section>
      {ready && <header />}
      <BrowserRouter basename="/app/">
        <Counter />
        <Routes>
          <Route path="*" element={<Page />} />
        </Routes>
      </BrowserRouter>
      <BrowserRouter basename="/app/items/">
        <Counter />
        <Routes>
          <Route path="*" element={<Page />} />
        </Routes>
      </BrowserRouter>
    </section>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
