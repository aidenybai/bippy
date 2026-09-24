import { lazy, Suspense, useRef } from "react";
import { Named, TextInput, Unnamed } from "./input";

const Widget = lazy(() => import("./lazy-widget").then((mod) => ({ default: mod.LazyWidget })));
const DefaultWidget = lazy(() => import("./lazy-widget"));

export const App = () => {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <form>
      <TextInput ref={ref} placeholder="name" />
      <Unnamed label="anon" />
      <Named label="named" />
      <Suspense fallback={<progress />}>
        <Widget n={7} />
        <DefaultWidget />
      </Suspense>
    </form>
  );
};
