import { useEffect, useState } from "react";

interface User {
  name: string;
}

interface Item {
  id: string;
  title: string;
}

export function Dashboard({
  status,
  user,
}: {
  status: "idle" | "loading" | "error";
  user: User | null;
}) {
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    fetchItems().then(setItems);
  }, []);
  if (status === "loading") return <Spinner />;
  if (!user) return <SignIn />;
  return (
    <main>
      <h1>{user.name}</h1>
      {items.length > 0 ? <List items={items} /> : <Empty />}
      <button onClick={() => setCount(count + 1)}>{count}</button>
    </main>
  );
}

function Spinner() {
  return <div className="spinner" />;
}

function SignIn() {
  return <a href="/login">Sign in</a>;
}

function Empty() {
  return <p>No items</p>;
}

function List({ items }: { items: Item[] }) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>{item.title}</li>
      ))}
    </ul>
  );
}

async function fetchItems(): Promise<Item[]> {
  return [{ id: "1", title: "First" }];
}
