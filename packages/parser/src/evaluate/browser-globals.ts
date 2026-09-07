import type { StaticHostNodeValue, StaticValue } from "../types.js";
import { primitiveValue, unknownPrimitiveValue, unknownValue } from "./values.js";

type BrowserMember =
  | "window"
  | "document"
  | "navigator"
  | "location"
  | "body"
  | "html"
  | "head"
  | "function"
  | "object"
  | "string"
  | "number"
  | "boolean";

/** Members of the analyzed page's `window`; the page is a top-level browsing context, so `top` and `parent` are the window itself. */
const WINDOW_MEMBERS: Record<string, BrowserMember> = {
  window: "window",
  self: "window",
  globalThis: "window",
  top: "window",
  parent: "window",
  document: "document",
  navigator: "navigator",
  location: "location",
  localStorage: "object",
  sessionStorage: "object",
  history: "object",
  screen: "object",
  crypto: "object",
  performance: "object",
  visualViewport: "object",
  indexedDB: "object",
  customElements: "object",
  origin: "string",
  name: "string",
  innerWidth: "number",
  innerHeight: "number",
  outerWidth: "number",
  outerHeight: "number",
  scrollX: "number",
  scrollY: "number",
  pageXOffset: "number",
  pageYOffset: "number",
  devicePixelRatio: "number",
  screenX: "number",
  screenY: "number",
  isSecureContext: "boolean",
  closed: "boolean",
  matchMedia: "function",
  addEventListener: "function",
  removeEventListener: "function",
  dispatchEvent: "function",
  getComputedStyle: "function",
  getSelection: "function",
  scrollTo: "function",
  scroll: "function",
  scrollBy: "function",
  open: "function",
  close: "function",
  focus: "function",
  blur: "function",
  alert: "function",
  confirm: "function",
  prompt: "function",
  print: "function",
  postMessage: "function",
  atob: "function",
  btoa: "function",
};

const DOCUMENT_MEMBERS: Record<string, BrowserMember> = {
  defaultView: "window",
  location: "location",
  body: "body",
  documentElement: "html",
  head: "head",
  fonts: "object",
  styleSheets: "object",
  cookie: "string",
  referrer: "string",
  title: "string",
  readyState: "string",
  visibilityState: "string",
  URL: "string",
  domain: "string",
  characterSet: "string",
  dir: "string",
  hidden: "boolean",
  getElementById: "function",
  querySelector: "function",
  querySelectorAll: "function",
  getElementsByTagName: "function",
  getElementsByClassName: "function",
  createElement: "function",
  createElementNS: "function",
  createTextNode: "function",
  createRange: "function",
  addEventListener: "function",
  removeEventListener: "function",
  dispatchEvent: "function",
  hasFocus: "function",
  execCommand: "function",
  elementFromPoint: "function",
};

const NAVIGATOR_MEMBERS: Record<string, BrowserMember> = {
  clipboard: "object",
  serviceWorker: "object",
  mediaDevices: "object",
  geolocation: "object",
  permissions: "object",
  storage: "object",
  credentials: "object",
  locks: "object",
  userAgent: "string",
  language: "string",
  platform: "string",
  vendor: "string",
  appVersion: "string",
  product: "string",
  maxTouchPoints: "number",
  hardwareConcurrency: "number",
  onLine: "boolean",
  cookieEnabled: "boolean",
  webdriver: "boolean",
  pdfViewerEnabled: "boolean",
  sendBeacon: "function",
  share: "function",
  canShare: "function",
  vibrate: "function",
  registerProtocolHandler: "function",
};

const LOCATION_MEMBERS: Record<string, BrowserMember> = {
  href: "string",
  pathname: "string",
  search: "string",
  hash: "string",
  origin: "string",
  host: "string",
  hostname: "string",
  protocol: "string",
  port: "string",
  assign: "function",
  replace: "function",
  reload: "function",
};

const BROWSER_GLOBAL_MEMBERS: Record<string, Record<string, BrowserMember>> = {
  window: WINDOW_MEMBERS,
  globalThis: WINDOW_MEMBERS,
  document: DOCUMENT_MEMBERS,
  navigator: NAVIGATOR_MEMBERS,
  location: LOCATION_MEMBERS,
};

export const isBrowserGlobalName = (name: string): boolean => name in BROWSER_GLOBAL_MEMBERS;

export const isWindowAlias = (name: string): boolean => WINDOW_MEMBERS[name] === "window";

const LOCATION_MEMBER_NAME =
  /^(?:(?:window|globalThis|document)\.)?location\.(pathname|search|hash|origin|protocol|host|hostname|port|href)$/;
const WINDOW_ORIGIN_NAME = /^(?:(?:window|globalThis|self)\.)?origin$/;
const DOCUMENT_URL_NAME = /^(?:(?:window|globalThis)\.)?document\.(?:URL|documentURI)$/;

const ROUTE_LOCATION_MEMBERS = new Set(["pathname", "search", "hash"]);
const ORIGIN_LOCATION_MEMBERS = new Set(["origin", "protocol", "host", "hostname", "port"]);

/** The `location` members the page's origin and route (path, query, fragment) determine; unknown while the part they read is. */
export const getPageLocationMember = (
  origin: string | null,
  route: string | null,
  name: string,
): StaticValue | null => {
  const member = DOCUMENT_URL_NAME.test(name)
    ? "href"
    : WINDOW_ORIGIN_NAME.test(name)
      ? "origin"
      : LOCATION_MEMBER_NAME.exec(name)?.[1];
  if (member === undefined) return null;
  if (route === null && !ORIGIN_LOCATION_MEMBERS.has(member)) return null;
  if (origin === null && !ROUTE_LOCATION_MEMBERS.has(member)) return null;
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

const documentNodes = new Map<string, StaticHostNodeValue>();

const getDocumentNode = (tagName: string): StaticHostNodeValue => {
  let node = documentNodes.get(tagName);
  if (!node) {
    node = { kind: "host-node", tagName };
    documentNodes.set(tagName, node);
  }
  return node;
};

export const getBrowserGlobalMember = (
  objectName: string,
  member: string,
  resolveGlobal: (name: string) => StaticValue | null,
): StaticValue => {
  const memberKind = BROWSER_GLOBAL_MEMBERS[objectName]?.[member];
  const description = `${objectName}.${member}`;
  switch (memberKind) {
    case undefined:
      return unknownValue(description);
    case "window":
    case "document":
    case "navigator":
    case "location":
      return resolveGlobal(memberKind) ?? unknownValue(description);
    case "body":
    case "html":
    case "head":
      return getDocumentNode(memberKind);
    case "function":
      return { kind: "method", receiver: { kind: "global", name: objectName }, name: member };
    case "object":
      return { kind: "global", name: description };
    case "string":
    case "number":
    case "boolean":
      return unknownPrimitiveValue(memberKind, description);
  }
};
