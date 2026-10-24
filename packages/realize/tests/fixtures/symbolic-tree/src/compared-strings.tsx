import { useState } from "react";

declare function usePathname(): string;

export const NavLinks = () => {
  const pathname = usePathname();
  return (
    <nav>
      {pathname === "/" ? <b>Home</b> : <a href="/">Home</a>}
      {pathname === "/blog" ? <b>Blog</b> : <a href="/blog">Blog</a>}
      {pathname === "/about" ? <b>About</b> : <a href="/about">About</a>}
    </nav>
  );
};

export const CommandInput = ({ initial }: { initial: string }) => {
  const [command, setCommand] = useState(initial);
  return (
    <div>
      <input value={command} onChange={(event) => setCommand(event.target.value)} />
      {command === "help" ? <p>Type a command</p> : null}
    </div>
  );
};
