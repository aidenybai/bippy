import { it } from "vitest";

export const getDevtoolsTestOrSkip = (reactVersion: string) => {
  const reactMajorVersion = Number.parseInt(reactVersion.split(".")[0] ?? "0", 10);
  const isUnsupportedReactVersion = reactMajorVersion >= 19;
  return isUnsupportedReactVersion ? it.skip : it;
};
