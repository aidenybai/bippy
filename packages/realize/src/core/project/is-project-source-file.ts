import { sep } from "node:path";

const SOURCE_FILE_PATTERN = /\.[jt]sx?$/;

export const isProjectSourceFile = (fileName: string): boolean =>
  !fileName.includes(`${sep}node_modules${sep}`) &&
  !fileName.endsWith(".d.ts") &&
  SOURCE_FILE_PATTERN.test(fileName);
