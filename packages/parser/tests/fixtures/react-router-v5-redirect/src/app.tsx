import { lazy } from "react";
import { BrowserRouter, Redirect, Route, Switch } from "react-router-dom-v5";

const Layout = lazy(() => import("./layout"));
const Login = lazy(() => import("./login"));

export const App = () => (
  <BrowserRouter>
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/app" component={Layout} />
      <Redirect exact from="/" to="/login" />
    </Switch>
  </BrowserRouter>
);
