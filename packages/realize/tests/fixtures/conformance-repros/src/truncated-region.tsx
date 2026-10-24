import { useState } from "react";

export const Workspace = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [flags, setFlags] = useState({
    f0: false,
    f1: false,
    f2: false,
    f3: false,
    f4: false,
    f5: false,
    f6: false,
    f7: false,
    f8: false,
  });
  return (
    <main>
      <button onClick={() => setIsMenuOpen(!isMenuOpen)}>Menu</button>
      {isMenuOpen ? <nav>Open menu</nav> : null}
      <button onClick={() => setIsPanelOpen(!isPanelOpen)}>Panel</button>
      <button
        onClick={() =>
          setFlags({
            f0: true,
            f1: true,
            f2: true,
            f3: true,
            f4: true,
            f5: true,
            f6: true,
            f7: true,
            f8: true,
          })
        }
      >
        Show all
      </button>
      {isPanelOpen ? (
        <div>
          {flags.f0 ? <a>f0</a> : <b>f0</b>}
          {flags.f1 ? <a>f1</a> : <b>f1</b>}
          {flags.f2 ? <a>f2</a> : <b>f2</b>}
          {flags.f3 ? <a>f3</a> : <b>f3</b>}
          {flags.f4 ? <a>f4</a> : <b>f4</b>}
          {flags.f5 ? <a>f5</a> : <b>f5</b>}
          {flags.f6 ? <a>f6</a> : <b>f6</b>}
          {flags.f7 ? <a>f7</a> : <b>f7</b>}
          {flags.f8 ? <a>f8</a> : <b>f8</b>}
        </div>
      ) : null}
    </main>
  );
};
