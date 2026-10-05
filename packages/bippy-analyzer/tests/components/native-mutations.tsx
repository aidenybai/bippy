import { defaults, get, identity, set, sortBy } from "lodash-es";

interface Config {
  server: { port: number; host?: string };
  name: string;
  extra?: boolean;
}

/** Two text children become two HostText fibers, so the comparer checks the computed value. */
const Shown = ({ value }: { value: string }) => (
  <code>
    {"= "}
    {value}
  </code>
);

const config: Config = { server: { port: 80 }, name: "app" };
const returned = set(config, "server.host", "localhost");
const server = get(config, "server");
server.port = 8080;
const same = identity(config);
const filled = defaults(config, { name: "fallback", extra: true });
const items = [{ n: 2 }, { n: 1 }];
const sorted = sortBy(items, "n");
sorted[0].n = 99;

const stored = new Map<string, Config>();
stored.set("config", config);

export default function NativeMutations() {
  return (
    <ul>
      <li>
        <Shown value={String(config.server.host)} />
      </li>
      <li>
        <Shown value={String(returned === config)} />
      </li>
      <li>
        <Shown value={String(config.server.port)} />
      </li>
      <li>
        <Shown value={String(same === config)} />
      </li>
      <li>
        <Shown value={`${filled === config} ${config.extra}`} />
      </li>
      <li>
        <Shown value={String(items[1].n)} />
      </li>
      <li>
        <Shown value={String(stored.get("config") === config)} />
      </li>
    </ul>
  );
}

export const isExact = true;
