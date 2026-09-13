import { useEffect, useState } from "react";

const App = () => {
  const [hasContext, setHasContext] = useState(false);
  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    if (document.createElement("canvas").getContext("2d")) {
      import.meta.env.VITE_MESSAGE = "changed";
      setHasContext(true);
    }
    setIsReady(true);
  }, []);
  return (
    <main>
      {hasContext ? <canvas /> : <aside />}
      {isReady ? import.meta.env.VITE_MESSAGE === "changed" ? <strong /> : <footer /> : <i />}
    </main>
  );
};

export default App;
