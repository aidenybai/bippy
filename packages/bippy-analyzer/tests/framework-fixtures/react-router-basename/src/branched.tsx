import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { Page } from "./page";

const isMatched = Math.random() > 0.5;
createRoot(document.getElementById("root")!).render(
  <section>
    {isMatched ? <header /> : <footer />}
    <BrowserRouter basename={isMatched ? "/app/" : "/elsewhere/"}>
      <Routes>
        <Route path="*" element={<Page />} />
      </Routes>
    </BrowserRouter>
  </section>,
);
