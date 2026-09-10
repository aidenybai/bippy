import * as flags from "./shared/flags";

const checks = Object.keys(flags).sort();

const describeMask = (mask: number): string[] => {
  const matched: string[] = [];
  for (let index = -1; ++index < checks.length; ) {
    const check = checks[index];
    const flag = flags[check as keyof typeof flags];
    if (typeof flag === "number" && (mask & flag) === flag) matched.push(check);
  }
  return matched;
};

const numericFlags = Object.entries(flags)
  .filter(([, value]) => typeof value === "number")
  .sort(([left], [right]) => left.localeCompare(right));

export const isExact = true;

export default function NamespaceKeys() {
  return (
    <ul>
      {checks.map((check) => (
        <li key={check}>{check}</li>
      ))}
      <li>
        <span>mask</span>
        {describeMask(flags.boolean | flags.spaceSeparated).join(" ")}
      </li>
      <li>
        <span>entries</span>
        {numericFlags.map(([name, value]) => `${name}=${value}`).join(";")}
      </li>
      <li>
        <span>values</span>
        {Object.values(flags).length}
      </li>
    </ul>
  );
}
