interface MacroReference {
  replaceWith: (value: unknown) => void;
}

interface MacroConfiguration {
  text?: string;
}

interface MacroArguments {
  references: { default: MacroReference[] };
  babel: { types: { stringLiteral: (value: string) => unknown } };
  config?: MacroConfiguration;
}

const { createMacro } = require("babel-plugin-macros");

module.exports = createMacro(
  ({ references, babel, config }: MacroArguments) => {
    if (typeof window !== "undefined") throw new Error("Build tooling received a DOM");
    if (process.env.NODE_ENV !== "development") throw new Error("Missing compile environment");
    for (const reference of references.default) {
      reference.replaceWith(babel.types.stringLiteral(config?.text ?? "default"));
    }
  },
  { configName: "greeting" },
);
