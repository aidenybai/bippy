import { getOtherMessage } from "./other-environment";

const environment = import.meta.env;
const initial = environment.VITE_MESSAGE;
environment.VITE_MESSAGE = "changed";
environment.DEFINED = "mutated";

const App = () => (
  <main>
    before: {initial}
    alias: {environment.VITE_MESSAGE}
    direct: {import.meta.env.VITE_MESSAGE}
    other: {getOtherMessage()}
    defined alias: {environment.DEFINED}
    defined direct: {import.meta.env.DEFINED}
  </main>
);

export default App;
