import type { ProjectContext, SourceLocation, StaticValue } from "../types.js";
import { nativeFunction } from "./stubs.js";
import { recordInputSource } from "./predicates.js";
import { createErrorValue } from "./errors.js";
import { resolvedPromiseValue } from "./promises.js";
import {
  FALSE_VALUE,
  TRUE_VALUE,
  getObjectProperty,
  isKnownString,
  jsonValue,
  objectFromRecord,
  primitiveValue,
  thrownValue,
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
 * a GET for one of its files resolves to a 200 response holding that file, as
 * the page receives it. Any other request is network the analysis cannot see.
 */
export const callFetch = (
  project: ProjectContext,
  args: StaticValue[],
  location: SourceLocation | null,
): StaticValue => {
  const [resource, init] = args;
  const response = (reason: string): StaticValue =>
    recordInputSource(unknownValue(reason, location), "fetch", location);
  if (!isKnownString(resource)) return response("fetch of a dynamic URL");
  if (isGetRequest(init) !== true) return response(`fetch(${resource.value}) request`);
  const body = project.readServedAsset(resource.value);
  if (body === null) return response(`fetch(${resource.value})`);
  return resolvedPromiseValue(createServedResponse(resource.value, body, location));
};
