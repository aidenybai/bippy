import React, { Children, cloneElement, isValidElement, type ReactNode } from "react";

// React Router v5's `Switch`: the child to render is picked by matching each
// route against a location. When that location is uncertain the picked child is
// a branch, and cloning it must clone every alternative rather than give up.

interface RouteProps {
  path: string;
  label: string;
  computedMatch?: string;
}

const Route = ({ path, label, computedMatch }: RouteProps) => (
  <article data-path={path} data-match={computedMatch}>
    {label}
  </article>
);

const Switch = ({ location, children }: { location: string; children: ReactNode }) => {
  let element: React.ReactElement<RouteProps> | null = null;
  let match: string | null = null;
  Children.forEach(children, (child) => {
    if (match === null && isValidElement<RouteProps>(child)) {
      element = child;
      match = child.props.path === location ? location : null;
    }
  });
  return match !== null && element !== null
    ? cloneElement(element, { computedMatch: match })
    : null;
};

export default function CloneElementBranches() {
  const location = window.innerWidth > 100 ? "/wide" : "/narrow";
  return (
    <main>
      <Switch location={location}>
        <Route path="/wide" label="wide" />
        <Route path="/narrow" label="narrow" />
      </Switch>
    </main>
  );
}

export const minCoverage = 1;
