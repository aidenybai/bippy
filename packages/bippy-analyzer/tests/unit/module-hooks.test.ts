import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("hooks from one module", () => {
  const project = analyzeFixture("conformance-repros", "redux-drawer");

  it("changes what every hook from a module returns when a handler calls into one", () => {
    const [handler] = getComponent(project, "DrawerToggle").analysis.handlers;
    expect(handler?.updates.map((update) => update.binding.name).toSorted()).toEqual([
      "dispatch",
      "isOpen",
    ]);
  });
});
