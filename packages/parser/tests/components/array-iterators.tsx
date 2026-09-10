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

type PropsHook = (props: Record<string, unknown>) => Record<string, unknown>;

const createForOfIteratorHelperLoose = <Item,>(iterable: Item[]) => {
  if (typeof Symbol === "undefined" || iterable[Symbol.iterator] == null) {
    let index = 0;
    return () =>
      index >= iterable.length
        ? { done: true, value: undefined }
        : { done: false, value: iterable[index++] };
  }
  const iterator = iterable[Symbol.iterator]();
  return iterator.next.bind(iterator);
};

const composedHooks: PropsHook[] = [
  (props) => ({ ...props, role: "dialog" }),
  (props) => ({ ...props, tabIndex: -1 }),
];

const useComposedProps = (initial: Record<string, unknown>) => {
  let htmlProps = initial;
  for (
    let iterator = createForOfIteratorHelperLoose(composedHooks), step = iterator();
    !step.done;
    step = iterator()
  ) {
    htmlProps = step.value(htmlProps);
  }
  const definedProps: Record<string, unknown> = {};
  for (const prop in htmlProps) {
    if (htmlProps[prop] !== undefined) definedProps[prop] = htmlProps[prop];
  }
  return definedProps;
};

const ManualIteration = () => {
  const props = useComposedProps({ id: "backdrop", hidden: undefined });
  const iterator = matches.values();
  const first = iterator.next();
  const rest = [...iterator];
  return (
    <div {...props}>
      {props.role === "dialog" ? <p>dialog</p> : <p>other</p>}
      <span>{first.done ? "done" : first.value.id}</span>
      <span>{rest.length}</span>
    </div>
  );
};

export default () => (
  <main>
    <MatchList />
    <EntryPairs />
    <ManualIteration />
  </main>
);
