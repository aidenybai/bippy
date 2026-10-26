import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("prop witnesses", () => {
  const project = analyzeFixture("conformance-repros", "prop-witnesses");
  const getWitnesses = (name: string) => getComponent(project, name).report.propWitnesses;

  it("sets a field of an object prop to the literal a state compares it with", () => {
    expect(getWitnesses("NoticeCard")).toContainEqual({
      props: {
        notice: {
          kind: "Object",
          fields: {
            type: { kind: "Value", value: "success" },
            title: { kind: "Value", value: "text" },
            dismissible: { kind: "Value", value: false },
          },
          isOpen: false,
        },
      },
      states: [0],
    });
  });

  it("leaves out an optional node prop for a state that renders without children", () => {
    expect(getWitnesses("NoticeCard")).toContainEqual({
      props: { children: { kind: "Undefined" } },
      states: [5],
    });
  });

  it("repeats a sampled item until an array is long enough", () => {
    expect(getWitnesses("Runs")).toContainEqual({
      props: {
        runs: {
          kind: "Array",
          items: [
            { kind: "Value", value: "text" },
            { kind: "Value", value: "text" },
          ],
        },
      },
      states: [0],
    });
  });

  it("sets every prop a conjunction needs at once", () => {
    expect(getWitnesses("Flags")).toEqual([
      {
        props: { a: { kind: "Value", value: true }, b: { kind: "Value", value: true } },
        states: [0],
      },
      {
        props: { c: { kind: "Value", value: true }, d: { kind: "Value", value: "z" } },
        states: [2],
      },
    ]);
  });

  it("samples a string or a number for a field a state needs truthy", () => {
    expect(getWitnesses("PhotoDetails")).toEqual([
      {
        props: {
          photo: {
            kind: "Object",
            fields: { make: { kind: "Value", value: "text" }, iso: { kind: "Value", value: null } },
            isOpen: false,
          },
        },
        states: [0],
      },
      {
        props: {
          photo: {
            kind: "Object",
            fields: { make: { kind: "Value", value: null }, iso: { kind: "Value", value: 1 } },
            isOpen: false,
          },
        },
        states: [2],
      },
    ]);
  });
});
