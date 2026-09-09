export const isPartial = true;

const featureFlag = process.env.FIXTURE_FEATURE;

const readSeed = (): string | null =>
  window.localStorage.getItem(`seed:${featureFlag ?? "default"}`);

export default function InputProvenance() {
  const seed = readSeed();
  const isLucky = Math.random() < 0.5;
  return (
    <main>
      {featureFlag === undefined ? <em>flag unset</em> : <b>{featureFlag}</b>}
      {featureFlag === "beta" && <mark>beta</mark>}
      {seed === null ? <i>no seed</i> : <s>seeded</s>}
      {isLucky ? <u>lucky</u> : <small>unlucky</small>}
    </main>
  );
}
