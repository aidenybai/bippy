import { useState } from "react";

interface BadgeProps {
  count: number;
  label?: string;
}

const Badge = ({ count, label }: BadgeProps) => {
  if (count === 0) return null;
  return (
    <span className="badge">
      {label && <em>{label}</em>}
      {count > 9 ? "9+" : count}
    </span>
  );
};

const Toggle = () => {
  const [isOpen, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(!isOpen)}>
        toggle
      </button>
      {isOpen && <section>open</section>}
      {isOpen ? <p>yes</p> : <p>no</p>}
      {!isOpen && "closed"}
    </div>
  );
};

const Status = ({ status }: { status: "idle" | "loading" | "error" }) => {
  switch (status) {
    case "loading":
      return <progress />;
    case "error":
      return <strong>error</strong>;
    default:
      return <span>idle</span>;
  }
};

export default function Conditionals() {
  const isEnabled = true;
  return (
    <div>
      <Badge count={0} />
      <Badge count={5} label="new" />
      <Badge count={12} />
      <Toggle />
      <Status status="loading" />
      <Status status="idle" />
      {isEnabled ? <b>enabled</b> : <i>disabled</i>}
    </div>
  );
}
