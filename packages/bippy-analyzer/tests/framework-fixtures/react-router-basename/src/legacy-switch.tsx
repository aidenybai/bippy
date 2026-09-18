import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Switch } from "react-router-dom";

const Miss = () => <aside />;
const Match = () => <main>matched</main>;

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Switch>
      <Route exact path="/other" component={Miss} />
      <Route path="/" component={Match} />
    </Switch>
  </BrowserRouter>,
);
