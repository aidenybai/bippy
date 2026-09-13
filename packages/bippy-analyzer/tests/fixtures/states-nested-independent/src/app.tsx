import { useFlag } from "flag-kit";

const Header = ({ isDark }: { isDark: boolean }) =>
  isDark ? <header className="dark" /> : <header className="light" />;

export const App = () => {
  const isCompact = useFlag("compact");
  const isDark = useFlag("dark");
  return (
    <main>
      <Header isDark={isDark} />
      {isCompact ? <small>compact</small> : <p>spacious</p>}
    </main>
  );
};
