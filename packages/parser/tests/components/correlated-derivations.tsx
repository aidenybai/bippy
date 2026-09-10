import { EventEmitter } from "./shared/node-events";

/** The listener comes out of an opaque module, so nothing about it is known statically. */
const emitter = new EventEmitter();

/**
 * One uncertain source: the current path is `/login` unless an opaque listener
 * replaced it. Every component derives its own test from the same opaque call
 * (a render is pure, so the call answers the same each time), and the three
 * tests must share one decision: two states, not eight.
 */
const usePathname = (): string => {
  const pendingListener = emitter.listeners("navigate")[0];
  return pendingListener ? "/settings" : "/login";
};

const Header = () => {
  const pathname = usePathname();
  const isHomepage = pathname === "/login" || pathname === "/";
  return <header>{isHomepage ? <b>welcome</b> : <i>back</i>}</header>;
};

const Sidebar = () => {
  const pathname = usePathname();
  const isSettings = pathname.startsWith("/settings");
  return <aside>{isSettings && <nav>settings nav</nav>}</aside>;
};

const Footer = () => {
  const pathname = usePathname();
  if (pathname !== "/login") return <footer>signed in</footer>;
  return <footer>sign in</footer>;
};

export const isPartial = true;
export const stateCount = 2;

export default function CorrelatedDerivations() {
  return (
    <div>
      <Header />
      <Sidebar />
      <Footer />
    </div>
  );
}
