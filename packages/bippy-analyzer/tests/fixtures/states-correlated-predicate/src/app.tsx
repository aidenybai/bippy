import { useFlag } from "flag-kit";

const Toolbar = ({ isCompact }: { isCompact: boolean }) => (
  <nav>{isCompact ? <button type="button" /> : <menu />}</nav>
);

export const App = () => {
  const isCompact = useFlag("compact");
  return (
    <main>
      <Toolbar isCompact={isCompact} />
      {isCompact ? <small>compact</small> : <p>spacious</p>}
      {!isCompact ? <aside>details</aside> : <span>summary</span>}
    </main>
  );
};
