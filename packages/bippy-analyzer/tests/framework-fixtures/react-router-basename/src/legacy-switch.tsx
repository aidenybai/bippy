import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Switch, useParams } from "react-router-dom";

const Miss = () => <aside />;
const Match = ({ location }: { location: { pathname: string } }) => {
  const params = useParams<{ section: string }>();
  return (
    <main>
      {params.section}:{location.pathname}
    </main>
  );
};
const EmptyChildrenFallback = () => <footer />;
const InheritedMatch = () => {
  const params = useParams<{ identifier: string }>();
  return <output>{params.identifier}</output>;
};
const NestedMatch = () => {
  const params = useParams<{ identifier: string }>();
  return (
    <>
      <span>{params.identifier}</span>
      <Route component={InheritedMatch} />
    </>
  );
};

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Switch location={{ pathname: "/forced/settings", search: "", hash: "", state: null }}>
      <Route exact path="/other" component={Miss} />
      <Route path="/forced/:section" component={Match} />
    </Switch>
    <Route path="/" children={[]} component={EmptyChildrenFallback} />
    <Route
      location={{ pathname: "/nested/42", search: "", hash: "", state: null }}
      path="/nested/:identifier"
      component={NestedMatch}
    />
  </BrowserRouter>,
);
