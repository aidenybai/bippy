import * as palette from "./shared/palette";

function describeKey(key: string) {
  return `raw:${key}`;
}
describeKey = (key: string) => `key:${key}`;

const dynamicKey = navigator.userAgent;

const registry = new Map<string, string>([["theme", "dark"]]);
registry.set(dynamicKey, "runtime");

const flags = new Set(["beta"]);
flags.add(dynamicKey);

const paletteKeys: string[] = [];
for (const key in palette) paletteKeys.push(key);

const facts = [
  registry.has("theme"),
  flags.has("beta"),
  Object.keys(palette).join(","),
  Object.values(palette).join(""),
  Object.entries(palette).length,
  paletteKeys.join(","),
  String.fromCharCode(72, 105),
  String.fromCodePoint(0x1f600).length,
  {}.constructor === Object,
  Object.create(null).constructor === undefined,
  describeKey("theme"),
];

export const isExact = true;

export default function DefiniteMembers() {
  return (
    <ul>
      {facts.map((fact, index) => (
        <li key={index}>{String(fact)}</li>
      ))}
    </ul>
  );
}
