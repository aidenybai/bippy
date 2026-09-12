import { createRoot } from "react-dom/client";
import { BrowserRouter, useLocation } from "react-router";

const locations = new Set<object>();
const LocationIdentity = () => {
  const location = useLocation();
  const isRepeated = locations.has(location);
  locations.add(location);
  return isRepeated ? <strong /> : <em />;
};

createRoot(document.getElementById("root")!).render(
  <section>
    <BrowserRouter basename="/app/">
      <LocationIdentity />
    </BrowserRouter>
    <BrowserRouter basename="/app/">
      <LocationIdentity />
    </BrowserRouter>
  </section>,
);
