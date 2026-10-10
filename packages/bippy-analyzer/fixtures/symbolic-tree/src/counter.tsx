import { useState } from "react";

const Loading = () => <p>Loading…</p>;

const Button = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button onClick={onClick}>{children}</button>
);

export const App = ({ isLoading }: { isLoading: boolean }) => {
  const [count, setCount] = useState(0);
  return isLoading ? <Loading /> : <Button onClick={() => setCount(count + 1)}>{count}</Button>;
};
