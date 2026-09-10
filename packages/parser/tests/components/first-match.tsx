import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { EventEmitter } from "./shared/node-events";

const emitter = new EventEmitter();

/** The pathname is read from an opaque module: two routes test it with two different patterns. */
const usePathname = (): string => emitter.listeners("path")[0];

interface Match {
  path: string;
  url: string;
  isExact: boolean;
}

const matchPath = (pathname: string, path: string): Match | null => {
  const match = new RegExp(`^${path}`).exec(pathname);
  if (!match) return null;
  return { path, url: match[0], isExact: pathname === match[0] };
};

interface RouteProps {
  path: string;
  computedMatch?: Match;
  children?: ReactNode;
}

const Route = ({ computedMatch, children }: RouteProps) => (
  <section data-url={computedMatch?.url}>{children}</section>
);

/**
 * Whether the first route matches and whether the second does are two
 * decisions over one pathname: first match, second match, or none. No
 * combination is contradictory, so every alternative is reachable.
 */
const Switch = ({ children, pathname }: { children: ReactNode; pathname: string }) => {
  let element: ReactElement<RouteProps> | undefined;
  let match: Match | null | undefined;
  Children.forEach(children, (child) => {
    if (match == null && isValidElement<RouteProps>(child)) {
      element = child;
      match = matchPath(pathname, child.props.path);
    }
  });
  return match && element ? cloneElement(element, { computedMatch: match }) : null;
};

export const isPartial = true;
export const stateCount = 3;

export default function FirstMatch() {
  const pathname = usePathname();
  return (
    <main>
      <Switch pathname={pathname}>
        <Route path="/settings">
          <h1>settings</h1>
        </Route>
        <Route path="/">
          <h1>home</h1>
        </Route>
      </Switch>
    </main>
  );
}
