import { describe, expect, it } from "vite-plus/test";
import { parseDotenv } from "../src/corpus/process-environment.js";

describe("dotenv files", () => {
  it("parses like dotenv: multi-line quotes, comments, last assignment wins", () => {
    const parsed = parseDotenv(
      [
        "# leading comment",
        'MODE="development"',
        "export URL=http://localhost:3002 # trailing comment",
        "EMPTY=",
        "KEY='line one",
        "line two'",
        'ESCAPED="a\\nb"',
        "SINGLE='a\\nb'",
        "COLON: spaced value",
        "URL=http://localhost:3003",
      ].join("\r\n"),
    );
    expect(parsed).toEqual({
      MODE: "development",
      URL: "http://localhost:3003",
      EMPTY: "",
      KEY: "line one\nline two",
      ESCAPED: "a\nb",
      SINGLE: "a\\nb",
      COLON: "spaced value",
    });
  });
});
