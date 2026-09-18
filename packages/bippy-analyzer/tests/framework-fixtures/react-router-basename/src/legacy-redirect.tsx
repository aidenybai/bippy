import { createRoot } from "react-dom/client";
import { BrowserRouter, Redirect, Route, Switch } from "react-router-dom";

const Dashboard = () => <main />;

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Switch>
      <Route exact path="/">
        <Redirect to={{ pathname: "/dashboard" }} />
      </Route>
      <Route path="/dashboard" component={Dashboard} />
    </Switch>
  </BrowserRouter>,
);
