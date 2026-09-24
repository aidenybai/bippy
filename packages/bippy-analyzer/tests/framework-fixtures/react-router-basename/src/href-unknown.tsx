import { createRoot } from "react-dom/client";
import { BrowserRouter, useHref } from "react-router";

const Page = () => (
  <main>
    {useHref({ pathname: "/", search: "q=1" })}
    <i />
  </main>
);
createRoot(document.getElementById("root")!).render(
  <BrowserRouter basename="/app/">
    <Page />
  </BrowserRouter>,
);
