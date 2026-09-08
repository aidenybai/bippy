import { useEffect, useState } from "react";

const later = <Value,>(value: Value): Promise<Value> =>
  new Promise((resolve) => setTimeout(() => resolve(value), 0));

interface Profile {
  name: string;
  address?: { city: string };
}

const loadProfile = (): Promise<Profile | null> =>
  later({ name: "Ada", address: { city: "London" } });

const AwaitPositions = () => {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    let cache: Profile | null = null;
    (async () => {
      const city = (await loadProfile())?.address?.city ?? "nowhere";
      const cached = cache ?? (await loadProfile());
      const name = cached?.name ? cached.name : await later("anonymous");
      const [count, label] = [(await later([1, 2])).length, `${await later("items")}!`];
      const flag = cache !== null && (await later(false));
      const total = 40 + (await later(2));
      cache = cached;
      setLines([
        city,
        String(cached?.name),
        name,
        `${count} ${label}`,
        String(flag),
        String(total),
        String((await Promise.all([later("a"), later("b")])).join("")),
        String((await later(3)) > 2),
      ]);
    })();
  }, []);
  return (
    <ul>
      {lines.map((line, index) => (
        <li key={index}>
          {index}: {line}
        </li>
      ))}
    </ul>
  );
};

export default AwaitPositions;
