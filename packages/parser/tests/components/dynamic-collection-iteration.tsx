const dynamicKey = navigator.userAgent;
const isWide = dynamicKey.includes("Chrome");

const ids = new Set(["alpha"]);
ids.add(dynamicKey);

const labels = new Map<string, string>([["alpha", "Alpha"]]);
labels.set(dynamicKey, "Runtime");

const rows = Array.from(ids, (id) => ({ id, label: labels.get(id) ?? "?" }));

const seeded = new Set(isWide ? ["wide", "shared"] : ["narrow", "shared"]);
seeded.add("extra");

const tags = new Set([...rows.map((row) => row.label), "fixed"]);

export const isPartial = true;

export default function DynamicCollectionIteration() {
  return (
    <ul>
      {rows.map((row) => (
        <li key={row.id}>{row.label}</li>
      ))}
      {[...labels.values()].map((label) => (
        <li key={label}>{label.toUpperCase()}</li>
      ))}
      <li>{[...seeded].join(",")}</li>
      <li>{seeded.has("shared") ? "shared" : "unshared"}</li>
      <li>{tags.has("fixed") ? "fixed" : "unfixed"}</li>
    </ul>
  );
}
