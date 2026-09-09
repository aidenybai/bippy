import * as shared from "./shared/index";

const keys = Object.keys(shared);
const valueNames = Object.values(shared).map((exported) => exported.name);
const entryLabels = Object.entries(shared).map(([name, exported]) => `${name}=${exported.name}`);

const enumerated: string[] = [];
for (const name in shared) {
  enumerated.push(name);
}

export const isExact = true;

export default function NamespaceEnumeration() {
  return (
    <dl>
      <dt>keys</dt>
      <dd>{keys.join(",")}</dd>
      <dt>values</dt>
      <dd>{valueNames.join(",")}</dd>
      <dt>entries</dt>
      <dd>{entryLabels.join(",")}</dd>
      <dt>for-in</dt>
      <dd>{enumerated.join(",")}</dd>
    </dl>
  );
}
