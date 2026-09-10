import { useEffect, useState } from "react";
import { EventEmitter } from "./shared/node-events";

const navigation = new EventEmitter();

/** The setter escapes into an opaque emitter, so the path is `/login` or whatever a listener set. */
const useCurrentPath = (): string => {
  const [pathname, setPathname] = useState("/login");
  useEffect(() => {
    navigation.on("navigate", setPathname);
    return () => {
      navigation.off("navigate", setPathname);
    };
  }, []);
  return pathname;
};

/**
 * `pathname === "/login"` is compared before an opaque method is called on the
 * same value and `pathname !== "/login"` after it. A call cannot change what a
 * value is, only what it holds, so both tests decide one way: when the path is
 * unknown the two string tests give four states, and the known path one more.
 */
const Header = ({ pathname }: { pathname: string }) => {
  const isSignIn = pathname === "/login";
  const isOauth = pathname.startsWith("/oauth");
  if (isOauth) return <header>oauth</header>;
  return <header>{isSignIn ? <b>sign in</b> : <span>app</span>}</header>;
};

const Footer = ({ pathname }: { pathname: string }) => (
  <footer>{pathname !== "/login" ? <a href="/logout">sign out</a> : null}</footer>
);

export const isPartial = true;
export const stateCount = 5;

export default function IdentityAfterOpaqueCall() {
  const pathname = useCurrentPath();
  return (
    <div>
      <Header pathname={pathname} />
      <Footer pathname={pathname} />
    </div>
  );
}
