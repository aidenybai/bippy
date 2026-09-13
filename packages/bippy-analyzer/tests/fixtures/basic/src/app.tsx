import { Suspense, useState } from "react";
import { Card } from "@/components/card";
import { Layout } from "./components";
import { ITEMS } from "./data";

export const App = () => {
  const [count, setCount] = useState(0);
  return (
    <Layout title="Hello">
      <ul className="list">
        {ITEMS.map((item) => (
          <Card key={item.id} label={item.label} />
        ))}
      </ul>
      {count > 0 && <span>positive</span>}
      <button onClick={() => setCount(count + 1)}>Count: {count}</button>
      <Suspense fallback={<p>loading</p>}>
        <footer>done</footer>
      </Suspense>
    </Layout>
  );
};
