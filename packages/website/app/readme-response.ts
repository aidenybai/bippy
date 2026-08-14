import { readFile } from "node:fs/promises";
import { join } from "node:path";

const README_PATH = join(process.cwd(), "../../README.md");

export const getReadmeResponse = async () =>
  new Response(await readFile(README_PATH, "utf8"), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      Vary: "Accept",
    },
  });
