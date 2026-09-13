import forEach from "array.prototype.foreach";
import hasOwn from "hasown";
import entries from "object.entries";
import trim from "string.prototype.trim";

interface Phrases {
  [key: string]: string | Phrases;
}

/** node-polyglot's constructor/extend/t, verbatim: call-bound es-shims and a `thisArg` on `forEach`. */
class Polyglot {
  phrases: Record<string, string> = {};

  constructor(options: { phrases: Phrases }) {
    this.extend(options.phrases || {});
  }

  extend(morePhrases: Phrases, prefix?: string) {
    forEach(
      entries(morePhrases || {}),
      function (this: Polyglot, entry: [string, string | Phrases]) {
        const key = entry[0];
        const phrase = entry[1];
        const prefixedKey = prefix ? `${prefix}.${key}` : key;
        if (typeof phrase === "object") {
          this.extend(phrase, prefixedKey);
        } else {
          this.phrases[prefixedKey] = phrase;
        }
      },
      this,
    );
  }

  t(key: string, options: Record<string, string> = {}) {
    const phrase = typeof this.phrases[key] === "string" ? this.phrases[key] : key;
    return trim(
      phrase.replace(/%\{(.*?)\}/g, (expression: string, argument: string) =>
        hasOwn(options, argument) ? options[argument] : expression,
      ),
    );
  }
}

const polyglot = new Polyglot({
  phrases: {
    "": "",
    ra: {
      navigation: { skip_nav: "  Skip to content " },
      action: { edit: "Edit %{name}" },
    },
  },
});

const Shown = ({ value }: { value: string }) => (
  <code>
    {"= "}
    {value}
  </code>
);

const EsShims = () => (
  <ul>
    <li>
      <Shown value={polyglot.t("ra.navigation.skip_nav")} />
    </li>
    <li>
      <Shown value={polyglot.t("ra.action.edit", { name: "post" })} />
    </li>
    <li>
      <Shown value={polyglot.t("ra.action.missing")} />
    </li>
    <li>
      <Shown value={String(hasOwn(polyglot.phrases, "ra.action.edit"))} />
    </li>
    <li>
      <Shown value={entries({ first: 1, second: 2 }).length.toString()} />
    </li>
  </ul>
);

export default EsShims;
