const Preferences = () => {
  const canvas = document.createElement("canvas");
  const isDark = canvas.getContext("2d") !== null;
  const preferences = {
    theme: isDark ? "dark" : "light",
    links: [{ rel: "icon", href: isDark ? "/dark.png" : "/light.png" }],
  };
  const serialized = JSON.stringify(preferences);
  return (
    <output data-length={serialized.length}>
      {serialized.split(",").map((part) => (
        <code key={part}>{part}</code>
      ))}
      {serialized.includes('"dark"') ? <b>dark</b> : <i>light</i>}
    </output>
  );
};

export const isPartial = true;

export default function JsonStringifyBranches() {
  return (
    <section>
      <Preferences />
    </section>
  );
}
