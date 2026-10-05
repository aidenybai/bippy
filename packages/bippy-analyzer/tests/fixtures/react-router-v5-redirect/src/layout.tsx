import { lazy, Suspense } from "react";
import { NavLink, Redirect, Route, Switch } from "react-router-dom-v5";

const Dashboard = lazy(() => import("./dashboard"));
const Tables = lazy(() => import("./tables"));
const NotFound = lazy(() => import("./not-found"));

const routes = [
  { path: "/dashboard", name: "Dashboard", component: Dashboard },
  { path: "/tables", name: "Tables", component: Tables },
  { path: "/hidden", name: "Hidden" },
];

const Layout = () => (
  <div>
    <ul>
      {routes.map((route) => (
        <li key={route.name}>
          <NavLink to={`/app${route.path}`} activeClassName="active">
            {route.name}
          </NavLink>
        </li>
      ))}
    </ul>
    <Suspense fallback={<p>loading page</p>}>
      <Switch>
        {routes.map((route, index) =>
          route.component ? (
            <Route
              key={index}
              exact
              path={`/app${route.path}`}
              render={(props) => <route.component {...props} />}
            />
          ) : null,
        )}
        <Redirect exact from="/app" to="/app/dashboard" />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  </div>
);

export default Layout;
