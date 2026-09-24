import { useFlag } from "flag-kit";

const Compact = () => <small>compact</small>;
const Spacious = () => <p>spacious</p>;

export const App = () => {
  const isCompact = useFlag("compact");
  return <main>{isCompact ? <Compact /> : <Spacious />}</main>;
};
