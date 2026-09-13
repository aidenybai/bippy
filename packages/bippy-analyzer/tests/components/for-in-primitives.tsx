// date-fns' `assign(target, object)` copies with `for (var key in object)`,
// which visits nothing for the `undefined` options it usually receives.

const assign = (target: Record<string, unknown>, source: object | undefined) => {
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      target[key] = Reflect.get(source, key);
    }
  }
  return target;
};

const collectKeys = (source: object) => {
  const keys: string[] = [];
  for (const key in source) keys.push(key);
  return keys;
};

const extendOptions = (options: object | undefined) => {
  const extended = assign({}, options);
  extended.timeZone = "America/New_York";
  return extended;
};

const Cell = ({ value }: { value: unknown }) => (
  <p>
    {String(value)}
    <br />
  </p>
);

export default function ForInPrimitives() {
  const fromUndefined = extendOptions(undefined);
  const fromLocale = extendOptions({ locale: "en-US" });
  return (
    <>
      <Cell value={Object.keys(fromUndefined).join(",")} />
      <Cell value={Object.keys(fromLocale).join(",")} />
      <Cell value={collectKeys(null).length} />
      <Cell value={collectKeys(42).length} />
      <Cell value={collectKeys(true).length} />
      <Cell value={collectKeys("abc").join("|")} />
    </>
  );
}

export const isExact = true;
