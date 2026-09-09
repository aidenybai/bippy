const dynamicKey = Math.random().toString(36).slice(2);

const wipeKeys = (record: Record<string, string>): void => {
  for (const key in record) delete record[key];
};

const schema: Record<string, string> = { $ref: "#/root", title: "Root" };
schema[dynamicKey] = "dynamic";
const snapshot = { ...schema };
wipeKeys(schema);
schema.$ref = "#/defs/root";

const { $ref: droppedRef, ...definition } = snapshot;
for (let round = 0; round < 64; round += 1) {
  delete definition[`${dynamicKey}${round}`];
}
const flattened = { ...definition, ...snapshot };

const Ref = ({ record }: { record: Record<string, string> }) =>
  record.$ref === undefined ? <em>no-ref</em> : <b>{record.$ref}</b>;

export const isPartial = true;

export default function DynamicKeyDeletion() {
  return (
    <section>
      <Ref record={schema} />
      <output>{droppedRef}</output>
      <Ref record={definition} />
      {definition.title === "Root" ? <i>title-kept</i> : <s>title-lost</s>}
      <Ref record={flattened} />
    </section>
  );
}
