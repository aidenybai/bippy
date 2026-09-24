// A callback that returns early on an undecided test: the code after the `if`
// only runs on the path that fell through, so what it pushes onto a list or
// writes into an object the fork already saw stays as uncertain as that path.

interface Item {
  label: string;
  isShown: boolean;
}

const collectShown = (items: Item[]) => {
  const shown: string[] = [];
  const counts = { hidden: 0 };
  items.forEach((item) => {
    if (!item.isShown) {
      counts.hidden += 1;
      return;
    }
    shown.push(item.label);
  });
  return { shown, hidden: counts.hidden };
};

let moduleVisits = 0;

const visitUnlessHidden = (isHidden: boolean) => {
  if (isHidden) return;
  moduleVisits += 1;
};

const attempt = (log: string[], isBroken: boolean) => {
  if (isBroken) throw new Error("broken");
  log.push("ok");
};

const ThrowOrContinue = ({ isBroken }: { isBroken: boolean }) => {
  const log: string[] = [];
  try {
    attempt(log, isBroken);
  } catch {
    log.push("caught");
  }
  log.push("done");
  return (
    <ol>
      {log.map((entry) => (
        <li key={entry}>{entry}</li>
      ))}
    </ol>
  );
};

const NestedForks = ({ hasExtra, isWide }: { hasExtra: boolean; isWide: boolean }) => {
  const tags: string[] = [];
  const marks = { count: 0 };
  const collect = () => {
    if (!hasExtra) return;
    marks.count += 1;
    if (!isWide) return;
    tags.push("wide");
  };
  collect();
  tags.push("end");
  return (
    <p>
      {marks.count}
      {tags.map((tag) => (
        <b key={tag}>{tag}</b>
      ))}
    </p>
  );
};

let moduleAttempts = 0;

/** Every path mutates the same heap values identically, so the join must agree instead of forking. */
const AgreeingPaths = ({ isFast }: { isFast: boolean }) => {
  const stats = { steps: 0 };
  const seen: string[] = [];
  const step = () => {
    moduleAttempts += 1;
    if (isFast) {
      stats.steps += 1;
      seen.push("visited");
      return;
    }
    stats.steps += 1;
    seen.push("visited");
  };
  step();
  return (
    <p>
      <code>
        {"= "}
        {String(stats.steps)}
      </code>
      <code>
        {"= "}
        {seen.join(",")}
      </code>
      <code>
        {"= "}
        {String(moduleAttempts)}
      </code>
    </p>
  );
};

export default function EarlyReturnMutation() {
  const hasExtra = window.location.hash === "#extra";
  const isWide = window.matchMedia("(min-width: 640px)").matches;
  const { shown, hidden } = collectShown([
    { label: "a", isShown: true },
    { label: "b", isShown: hasExtra },
  ]);
  visitUnlessHidden(hasExtra);
  return (
    <ul>
      {shown.map((label) => (
        <li key={label}>{label}</li>
      ))}
      <li>{hidden}</li>
      <li>{moduleVisits}</li>
      <ThrowOrContinue isBroken={hasExtra} />
      <NestedForks hasExtra={hasExtra} isWide={isWide} />
      <AgreeingPaths isFast={hasExtra} />
    </ul>
  );
}
