import type { ReactNode } from "react";

const Steps = ({ count }: { count: number }) => {
  const steps: ReactNode[] = [];
  for (let index = 0; index < count; index++) {
    steps.push(<li key={index}>step {index + 1}</li>);
  }
  return <ol>{steps}</ol>;
};

const Guarded = ({ user }: { user: { name: string; isAdmin: boolean } | null }) => {
  if (!user) {
    return <p>anonymous</p>;
  }
  let badge: ReactNode = null;
  if (user.isAdmin) {
    badge = <b>admin</b>;
  } else {
    badge = <i>member</i>;
  }
  return (
    <div>
      <span>{user.name}</span>
      {badge}
    </div>
  );
};

const Sections = ({ entries }: { entries: Array<[string, string[]]> }) => (
  <div>
    {entries.map(([title, lines]) => (
      <section key={title}>
        <h5>{title}</h5>
        {lines.length > 0 ? (
          <ul>
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p>empty</p>
        )}
      </section>
    ))}
  </div>
);

const Early = ({ mode }: { mode: string }) => {
  if (mode === "a") return <span>a</span>;
  if (mode === "b") return <span>b</span>;
  try {
    return <span>{mode.toUpperCase()}</span>;
  } catch {
    return <span>error</span>;
  }
};

const parsePair = (text: string): [string, number] => {
  const [name, count] = text.split(":");
  return [name!, Number(count)];
};

const Reassigned = ({ spec }: { spec: string }) => {
  let name: string;
  let count: number;
  let fallback = "none";
  const box = { label: "" };
  try {
    [name, count] = parsePair(spec);
  } catch {
    return <span>invalid</span>;
  }
  ({ label: box.label, missing: fallback = "filled" } = { label: name.toUpperCase() });
  let first: string;
  let second: string;
  [first, second] = [count > 1 ? "many" : "one", fallback];
  [first, second] = [second, first];
  return (
    <span>
      {box.label}:{count}:{first}/{second}
    </span>
  );
};

export default function ControlFlow() {
  return (
    <div>
      <Steps count={3} />
      <Guarded user={null} />
      <Guarded user={{ name: "ada", isAdmin: true }} />
      <Guarded user={{ name: "bob", isAdmin: false }} />
      <Sections
        entries={[
          ["first", ["x", "y"]],
          ["second", []],
        ]}
      />
      <Early mode="a" />
      <Early mode="z" />
      <Reassigned spec="apples:3" />
      <Reassigned spec="pear:1" />
    </div>
  );
}
