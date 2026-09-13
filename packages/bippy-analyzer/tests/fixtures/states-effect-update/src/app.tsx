import { useEffect, useState } from "react";

export const App = () => {
  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    setIsReady(true);
  }, []);
  return <main>{isReady ? <output>ready</output> : <progress />}</main>;
};
