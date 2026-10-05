interface MacroReference {
  replaceWith: (value: unknown) => void;
}

interface MacroConfiguration {
  text?: string;
}

interface MacroArguments {
  references: { default?: MacroReference[]; environment?: MacroReference[] };
  babel: { types: { stringLiteral: (value: string) => unknown } };
  config?: MacroConfiguration;
}

const { createMacro } = require("babel-plugin-macros");

module.exports = createMacro(
  ({ references, babel, config }: MacroArguments) => {
    if (typeof window !== "undefined") throw new Error("Build tooling received a DOM");
    if (process.env.NODE_ENV !== "development") throw new Error("Missing compile environment");
    for (const reference of references.default ?? []) {
      reference.replaceWith(babel.types.stringLiteral(config?.text ?? "default"));
    }
    for (const reference of references.environment ?? []) {
      reference.replaceWith(
        babel.types.stringLiteral(
          `${process.env.BIPPY_INHERITED ?? "unset"}:${process.env.BIPPY_DECLARED ?? "unset"}`,
        ),
      );
    }
  },
  { configName: "greeting" },
);
