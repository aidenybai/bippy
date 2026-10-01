interface RouteMatch {
  id: string;
  routeId: string;
}

const matches: RouteMatch[] = [
  { id: "__root__", routeId: "__root__" },
  { id: "/posts", routeId: "/posts" },
  { id: "/posts/$postId", routeId: "/posts/$postId" },
];

const describeMatches = (): string[] => {
  const described: string[] = [];
  for (const [index, { id, routeId }] of matches.entries()) {
    described.push(`${index}:${id}:${routeId}`);
  }
  return described;
};

const MatchList = () => {
  const indexes = [...matches.keys()];
  const ids = Array.from(matches.values(), (match) => match.id);
  return (
    <ol data-count={indexes.length}>
      {describeMatches().map((label) => (
        <li key={label}>{label}</li>
      ))}
      <li>{ids.join(" > ")}</li>
      <li>{indexes.map((index) => index * 2).join(",")}</li>
    </ol>
  );
};

const EntryPairs = () => {
  const pairs = [...["a", "b"].entries()].map(([index, letter]) => `${letter}${index}`);
  return <p>{pairs.join("")}</p>;
};

export default () => (
  <main>
    <MatchList />
    <EntryPairs />
  </main>
);
