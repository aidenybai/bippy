const glyphMap: Record<string, number> = { apple: 61973, check: 10003, plus: 43 };

const roleComponents: Record<string, string> = { button: "button", paragraph: "p" };

const toElementType = (props: { role?: string }): string => {
  const role = props.role;
  if (role) {
    const component = roleComponents[role];
    if (component && component.constructor === String) return component;
  }
  return "div";
};

const Glyph = ({ name }: { name: string }) => {
  let glyph: string | number = glyphMap[name] || "?";
  if (typeof glyph === "number") glyph = String.fromCodePoint(glyph);
  return <i data-glyph={glyph.constructor === String}>{glyph}</i>;
};

const Role = ({ role }: { role?: string }) => {
  const Component = toElementType({ role });
  return <Component data-role={role ?? "none"} />;
};

export default function LanguageConstructors() {
  const settings = { theme: "dark" };
  return (
    <section
      data-object={settings.constructor === Object}
      data-number={(42).constructor === Number}
      data-boolean={true.constructor === Boolean}
      data-chars={String.fromCharCode(72, 105)}
      data-codes={String.fromCodePoint(72, 0x1f600)}
    >
      <Glyph name="check" />
      <Glyph name="plus" />
      <Glyph name="missing" />
      <Role role="button" />
      <Role role="paragraph" />
      <Role />
    </section>
  );
}
