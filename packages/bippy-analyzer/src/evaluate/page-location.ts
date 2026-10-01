import type { HostDocument } from "../host/host-document.js";
import type { StaticValue } from "../types.js";
import { primitiveValue } from "./values.js";

/**
 * `document.baseURI`: the page's first `<base href>` resolved against the
 * document URL, else that URL (HTML's document base URL). Known only from the
 * page's own markup: a `<base>` the analysis never saw would win. Needs the
 * parts of the document URL the resolution reads: none for an absolute
 * `href`, the origin for a root-relative one, the whole URL otherwise.
 */
export const getDocumentBaseUri = (
  origin: string | null,
  route: string | null,
  hostDocument: HostDocument | null,
): StaticValue | null => {
  if (!hostDocument?.hasKnownMarkup) return null;
  const baseHref = hostDocument.getBaseHref();
  if (baseHref !== null && URL.canParse(baseHref)) return primitiveValue(new URL(baseHref).href);
  if (origin === null) return null;
  const isRootRelative = baseHref !== null && /^\/(?!\/)/.test(baseHref);
  if (route === null && !isRootRelative) return null;
  const documentUrl = new URL(route ?? "/", origin);
  const baseUrl =
    baseHref !== null && URL.canParse(baseHref, documentUrl)
      ? new URL(baseHref, documentUrl)
      : documentUrl;
  return primitiveValue(baseUrl.href);
};

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
