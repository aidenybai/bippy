import { useEffect, useState } from "react";

interface User {
  name: string;
}

interface Item {
  id: string;
  title: string;
}

declare const fetchItems: () => Promise<Item[]>;

const Spinner = () => <div className="spinner" />;
const SignIn = () => <a href="/login">Sign in</a>;
const Empty = () => <p>No items</p>;
const List = ({ items }: { items: Item[] }) => (
  <ul>
    {items.map((item) => (
      <li key={item.id}>{item.title}</li>
    ))}
  </ul>
);

export const Dashboard = ({
  status,
  user,
}: {
  status: "idle" | "loading" | "error";
  user: User | null;
}) => {
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
};
