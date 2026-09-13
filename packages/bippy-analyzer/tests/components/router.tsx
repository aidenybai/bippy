import {
  Children,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useContext,
} from "react";

interface RouteProps {
  path: string;
  element: ReactNode;
  children?: ReactNode;
}

interface RouterState {
  pathname: string;
  params: Record<string, string>;
}

const RouterContext = createContext<RouterState>({ pathname: "/", params: {} });
const OutletContext = createContext<ReactNode>(null);

const Router = ({ pathname, children }: { pathname: string; children: ReactNode }) => (
  <RouterContext value={{ pathname, params: {} }}>{children}</RouterContext>
);

const Route = (_props: RouteProps): ReactNode => null;

const matchPath = (pattern: string, pathname: string): Record<string, string> | null => {
  const patternSegments = pattern.split("/").filter(Boolean);
  const pathSegments = pathname.split("/").filter(Boolean);
  if (patternSegments.length > pathSegments.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < patternSegments.length; index++) {
    const segment = patternSegments[index];
    if (segment.startsWith(":")) params[segment.slice(1)] = pathSegments[index];
    else if (segment !== pathSegments[index]) return null;
  }
  return params;
};

const Routes = ({ children }: { children: ReactNode }) => {
  const { pathname } = useContext(RouterContext);
  const routes = Children.toArray(children).filter((child): child is ReactElement<RouteProps> =>
    isValidElement(child),
  );
  for (const route of routes) {
    const params = matchPath(route.props.path, pathname);
    if (params) {
      return (
        <RouterContext value={{ pathname, params }}>
          <OutletContext value={route.props.children}>{route.props.element}</OutletContext>
        </RouterContext>
      );
    }
  }
  return <p>not found</p>;
};

const Outlet = () => useContext(OutletContext);

const useParams = () => useContext(RouterContext).params;

const Link = ({ to, children }: { to: string; children: ReactNode }) => {
  const { pathname } = useContext(RouterContext);
  return (
    <a href={to} aria-current={pathname === to ? "page" : undefined}>
      {children}
    </a>
  );
};

const Layout = () => (
  <div className="layout">
    <nav>
      <Link to="/">home</Link>
      <Link to="/users/7">user</Link>
    </nav>
    <Outlet />
  </div>
);

const User = () => {
  const { id } = useParams();
  return <h2>user {id}</h2>;
};

export default function RouterFixture() {
  return (
    <Router pathname="/users/7">
      <Routes>
        <Route path="/" element={<h2>home</h2>} />
        <Route path="/users/:id" element={<Layout />}>
          <User />
        </Route>
        <Route path="/settings" element={<h2>settings</h2>} />
      </Routes>
    </Router>
  );
}
