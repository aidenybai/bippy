import { useFlag } from "flag-kit";

export const App = () => {
  const isCompact = useFlag("compact");
  const isDark = useFlag("dark");
  const isBeta = useFlag("beta");
  const isLegacy = useFlag("legacy");
  return (
    <main>
      {isCompact ? <small>compact</small> : <p>spacious</p>}
      {isDark ? <header className="dark" /> : <header className="light" />}
      {isBeta ? <mark>beta</mark> : <span>stable</span>}
      {isLegacy ? <del>legacy</del> : <ins>modern</ins>}
    </main>
  );
};
