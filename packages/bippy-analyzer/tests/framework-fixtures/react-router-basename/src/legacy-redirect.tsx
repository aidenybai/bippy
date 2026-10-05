import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Redirect, Route, Switch, useHistory } from "react-router-dom";

const Dashboard = () => {
  const history = useHistory();
  useEffect(() => history.push("/login"), [history]);
  return <main />;
};

const Login = () => <aside />;

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Switch>
      <Route exact path="/">
        <Redirect to={{ pathname: "/dashboard" }} />
      </Route>
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/login" component={Login} />
    </Switch>
  </BrowserRouter>,
);
