import type { ProjectContext, ServedRequest, SourceLocation, StaticValue } from "../types.js";
import { nativeFunction } from "./stubs.js";
import { createErrorValue } from "./errors.js";
import { resolvedPromiseValue } from "./promises.js";
import {
  FALSE_VALUE,
  TRUE_VALUE,
  getKnownObjectKeys,
  getObjectProperty,
  isKnownString,
  isNullish,
  jsonValue,
  objectFromRecord,
  primitiveValue,
  thrownValue,
  UNDEFINED_VALUE,
  unknownValue,
} from "./values.js";

const isGetRequest = (init: StaticValue | undefined): boolean | null => {
  if (init === undefined || (init.kind === "primitive" && init.value === undefined)) return true;
  if (init.kind !== "object") return null;
  const method = getObjectProperty(init, "method");
  if (method.kind === "primitive") {
    return method.value === undefined || String(method.value).toUpperCase() === "GET";
  }
  return null;
};

/** The request as the server receives it: its `Accept` header from a plain `headers` record; null when the headers are not fully known. */
const readServedRequest = (init: StaticValue | undefined): ServedRequest | null => {
  const headers = init?.kind === "object" ? getObjectProperty(init, "headers") : UNDEFINED_VALUE;
  if (isNullish(headers) === true) return { accept: undefined };
  if (headers.kind !== "object") return null;
  const keys = getKnownObjectKeys(headers);
  if (keys === null) return null;
  const acceptKey = keys.find((key) => key.toLowerCase() === "accept");
  if (acceptKey === undefined) return { accept: undefined };
  const accept = getObjectProperty(headers, acceptKey);
  return isKnownString(accept) ? { accept: accept.value } : null;
};

const parseBody = (body: string, location: SourceLocation | null): StaticValue => {
  try {
    return jsonValue(JSON.parse(body));
  } catch (error) {
    return thrownValue(
      "response body is not JSON",
      createErrorValue(
        "SyntaxError",
        [primitiveValue(error instanceof Error ? error.message : String(error))],
        location,
      ),
      location,
    );
  }
};

const createServedResponse = (
  url: string,
  body: string,
  location: SourceLocation | null,
): StaticValue =>
  objectFromRecord({
    ok: TRUE_VALUE,
    status: primitiveValue(200),
    statusText: primitiveValue(""),
    redirected: FALSE_VALUE,
    type: primitiveValue("basic"),
    url: primitiveValue(url),
    bodyUsed: FALSE_VALUE,
    headers: unknownValue("headers of a dev-server response", location),
    text: nativeFunction("text", () => resolvedPromiseValue(primitiveValue(body))),
    json: nativeFunction("json", () => resolvedPromiseValue(parseBody(body, location))),
    blob: nativeFunction("blob", () =>
      resolvedPromiseValue(unknownValue("Blob of a served asset", location)),
    ),
    arrayBuffer: nativeFunction("arrayBuffer", () =>
      resolvedPromiseValue(unknownValue("ArrayBuffer of a served asset", location)),
    ),
  });

/**
 * `fetch(url)`: the dev server serves the public directory at the URL root, so
 * a GET for one of its files (or for the HTML page it falls back to) resolves
 * to a 200 response holding that text, as the page receives it. Any other
 * request is network the analysis cannot see.
 */
export const callFetch = (
  project: ProjectContext,
  args: StaticValue[],
  location: SourceLocation | null,
): StaticValue => {
  const [resource, init] = args;
  if (!isKnownString(resource)) return unknownValue("fetch of a dynamic URL", location);
  const request = isGetRequest(init) === true ? readServedRequest(init) : null;
  if (request === null) return unknownValue(`fetch(${resource.value}) request`, location);
  const body = project.readServedAsset(resource.value, request);
  if (body === null) return unknownValue(`fetch(${resource.value})`, location);
  return resolvedPromiseValue(createServedResponse(resource.value, body, location));
};
