import { useEffect, useReducer, useRef } from "react";

export default () => {
  const cursor = useRef(0);
  const [selected, dispatch] = useReducer(() => cursor.current, -1);
  useEffect(() => {
    const handle = setInterval(() => {
      dispatch();
      cursor.current++;
      clearInterval(handle);
    }, 5);
    return () => clearInterval(handle);
  }, []);
  return (
    <main>
      <span>Selected:</span>
      {selected}
    </main>
  );
};
