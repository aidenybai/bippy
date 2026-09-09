import { Route, Switch } from "react-router-dom-v5";
import { App } from "./app";
import { HomePage } from "./home-page";
import { LoginPage } from "./login-page";
import { NotFoundPage } from "./not-found-page";

const paths = {
  authorize: "/oauth/authorize",
  root: "/",
  login: "/login",
  project: "/project/:projectId/features",
};

export const routes = (
  <Switch>
    <Route path={paths.authorize} exact>
      <section>authorize</section>
    </Route>
    <App>
      <Switch>
        <Route path={paths.root} exact component={HomePage} />
        <Route path={paths.login} exact render={() => <LoginPage mode="login" />} />
        <Route path={paths.project} exact component={HomePage} />
        <Route component={NotFoundPage} />
      </Switch>
    </App>
  </Switch>
);
