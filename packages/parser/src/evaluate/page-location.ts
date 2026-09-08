import type { StaticValue } from "../types.js";
import { primitiveValue } from "./values.js";

const ROUTE_MEMBERS = new Set(["pathname", "search", "hash"]);
const ORIGIN_MEMBERS = new Set(["origin", "protocol", "host", "hostname", "port"]);
const URL_MEMBERS = new Set([...ROUTE_MEMBERS, ...ORIGIN_MEMBERS, "href"]);

/** The `Location` member a global-object-relative name reads: `location.href`, `document.location.pathname`, `document.URL`, `origin`. */
const getLocationMemberName = (name: string): string | null => {
  if (name === "origin") return "origin";
  if (name === "document.URL" || name === "document.documentURI") return "href";
  const member = name.replace(/^(?:document\.)?location\./, "");
  return member !== name && URL_MEMBERS.has(member) ? member : null;
};

/** The `location` members the page's origin and route (path, query, fragment) determine; unknown while the part they read is. */
export const getPageLocationMember = (
  origin: string | null,
  route: string | null,
  name: string,
): StaticValue | null => {
  const member = getLocationMemberName(name);
  if (member === null) return null;
  if (route === null && !ORIGIN_MEMBERS.has(member)) return null;
  if (origin === null && !ROUTE_MEMBERS.has(member)) return null;
  const url = new URL(route ?? "", origin ?? "http://origin.invalid");
  const members: Record<string, string> = {
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    origin: url.origin,
    protocol: url.protocol,
    host: url.host,
    hostname: url.hostname,
    port: url.port,
    href: url.href,
  };
  return primitiveValue(members[member] ?? "");
};
