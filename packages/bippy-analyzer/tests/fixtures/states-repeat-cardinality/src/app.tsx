import { useFeed } from "feed-kit";

const Entry = ({ title }: { title: string }) => <li>{title}</li>;

export const App = () => {
  const items = useFeed();
  return (
    <ul>
      {items.map((item) => (
        <Entry key={item.id} title={item.title} />
      ))}
    </ul>
  );
};
