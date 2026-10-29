import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/values/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("a handler on an element passed through a prop", () => {
  const project = analyzeFixture("conformance-repros", "prop-element-handlers");

  it("is collected under the guards of the element that receives it", () => {
    const { analysis } = getComponent(project, "ShareDialog");
    expect(
      analysis.handlers.map((handler) => [
        handler.guards.map(formatSymbolicValue),
        handler.updates.map(
          (update) => `${update.binding.name} = ${formatSymbolicValue(update.value)}`,
        ),
      ]),
    ).toEqual([
      [[], ["isOpen = true"]],
      [["isOpen"], ["isCopied = true"]],
      [["isOpen"], ["isOpen = false"]],
    ]);
  });
});
