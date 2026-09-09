const dynamicKey = navigator.userAgent;

const registry = new Map<string, string>([["theme", "dark"]]);
registry.set(dynamicKey, "runtime");

const flags = new Set(["beta"]);
flags.delete(dynamicKey);

export const isPartial = true;

export default function DynamicMembers() {
  return (
    <section>
      <p data-theme={registry.get("theme")}>theme</p>
      {flags.has("beta") ? <em>beta</em> : <span>stable</span>}
    </section>
  );
}
