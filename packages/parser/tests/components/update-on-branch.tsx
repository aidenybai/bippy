/** `++`/`--` on a value branched by an uncertain test steps every alternative, so later comparisons stay decidable. */
let epoch = 0;
const hasWideGamut = Math.random() < 0.5;
if (hasWideGamut) epoch++;
epoch++;
let retries = hasWideGamut ? 3 : 2;
retries--;

export const isExact = true;

export default function UpdateOnBranch() {
  return (
    <section data-epoch={epoch} data-retries={retries}>
      {epoch > 0 ? <strong>changed</strong> : <em>initial</em>}
      {retries >= 1 ? <p>retrying</p> : <p>gave up</p>}
    </section>
  );
}
