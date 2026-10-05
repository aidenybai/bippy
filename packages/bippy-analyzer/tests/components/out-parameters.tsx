import pathToRegexp from "path-to-regexp";
import type { Key } from "path-to-regexp";

/** Two text children become two HostText fibers, so the comparer checks the computed value. */
const Shown = ({ value }: { value: string }) => (
  <code>
    {"= "}
    {value}
  </code>
);

const keys: Key[] = [];
const featureMatcher = pathToRegexp("/projects/:projectId/features/:featureId", keys, {
  end: true,
});

const partialKeys: Key[] = [
  {
    name: "prefix",
    prefix: "/",
    delimiter: "/",
    optional: false,
    repeat: false,
    pattern: "[^/]+?",
  },
];
pathToRegexp("/:section", partialKeys);

const matchedNames = (pathname: string): string => {
  const match = featureMatcher.exec(pathname);
  return match === null
    ? "miss"
    : keys.map((key, index) => `${key.name}=${match[index + 1]}`).join("&");
};

const RouteKeys = () => (
  <ul>
    <li>
      <Shown value={keys.map((key) => key.name).join(",")} />
    </li>
    <li>
      <Shown value={partialKeys.map((key) => key.name).join(",")} />
    </li>
    <li>
      <Shown value={matchedNames("/projects/12/features/flag")} />
    </li>
    <li>
      <Shown value={matchedNames("/projects/12")} />
    </li>
  </ul>
);

export default RouteKeys;
