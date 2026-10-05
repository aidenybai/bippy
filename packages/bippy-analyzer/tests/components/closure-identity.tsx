import { useCallback, useEffect, useState } from "react";

const Consumer = ({ onReady }: { onReady: () => number }) => {
  const [runs, setRuns] = useState(0);
  useEffect(() => {
    onReady();
    setRuns((count) => count + 1);
  }, [onReady]);
  return <output>runs {runs}</output>;
};

const ClosureIdentity = () => {
  const [items, setItems] = useState<number[]>([]);
  const [ready, setReady] = useState(0);
  const total = useCallback(() => items.length, [items]);
  useEffect(() => {
    if (items.length === 0) setItems([total() + 1]);
  }, [items, total]);
  const onReady = useCallback(() => {
    setReady((count) => count + 1);
    return 0;
  }, []);
  return (
    <section>
      <p>items {items.length}</p>
      <Consumer onReady={onReady} />
      <Consumer onReady={() => items.length} />
      <span>ready {ready}</span>
    </section>
  );
};

export default ClosureIdentity;
