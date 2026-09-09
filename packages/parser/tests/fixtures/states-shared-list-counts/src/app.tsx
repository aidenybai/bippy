import { useFeed } from "feed-kit";

export const App = () => {
  const items = useFeed();
  return (
    <main>
      <ul>
        {items.map((item) => (
          <li key={item.id}>{item.title}</li>
        ))}
      </ul>
      <ol>
        {items.map((item) => (
          <li key={item.id}>{item.id}</li>
        ))}
      </ol>
    </main>
  );
};
