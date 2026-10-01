// Stands in for PostHog's Django app server: renders the boot HTML that
// `posthog/templates/index.html` + `head.html` would (anonymous app context,
// Vite dev scripts pointing at the frontend dev server) and answers the API
// calls the unauthenticated login scene makes. Run from the PostHog clone root.
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";

const port = Number(process.env.POSTHOG_APP_PORT ?? 8000);
const viteUrl = process.env.POSTHOG_VITE_URL ?? "http://localhost:8234";

const preflight: unknown = JSON.parse(
  readFileSync(resolve("frontend/src/mocks/fixtures/_preflight.json"), "utf8"),
);

const appContext = {
  current_user: null,
  current_project: null,
  current_team: null,
  preflight,
  default_event_name: "$pageview",
  has_pageview: false,
  has_screen: false,
  has_person_email: false,
  persisted_feature_flags: [],
  anonymous: true,
  frontend_apps: {},
  effective_resource_access_control: {},
  resource_access_control: {},
  custom_products: [],
  switched_team: null,
};

const escapeForScript = (json: string): string => json.replace(/</g, "\\u003c");

const bootHtml = `<!doctype html>
<html lang="en" data-boot-theme="light">
  <head>
    <title>PostHog</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta charset="utf-8">
    <script id="posthog-app-user-preload">
      window.POSTHOG_APP_CONTEXT = ${escapeForScript(JSON.stringify(appContext))};
      window.JS_URL = ${JSON.stringify(viteUrl)};
      window.JS_CAPTURE_TIME_TO_SEE_DATA = false;
    </script>
    <script type="module">
      import RefreshRuntime from '${viteUrl}/@react-refresh'
      RefreshRuntime.injectIntoGlobalHook(window)
      window.$RefreshReg$ = () => {}
      window.$RefreshSig$ = () => (type) => type
      window.__vite_plugin_react_preamble_installed__ = true
    </script>
    <script type="module" src="${viteUrl}/@vite/client"></script>
    <script type="module" src="${viteUrl}/src/index.tsx"></script>
  </head>
  <body>
    <div id="root" translate="no"></div>
  </body>
</html>
`;

const sendJson = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

const notAuthenticated = {
  type: "authentication_error",
  code: "not_authenticated",
  detail: "Authentication credentials were not provided.",
};

const isViteReady = async (): Promise<boolean> => {
  try {
    return (await fetch(`${viteUrl}/@vite/client`, { method: "HEAD" })).ok;
  } catch {
    return false;
  }
};

const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
  const path = url.pathname;
  if (path === "/_preflight/") return sendJson(response, 200, preflight);
  if (path === "/api/users/@me/") return sendJson(response, 401, notAuthenticated);
  if (path.startsWith("/api/")) return sendJson(response, 404, { detail: "Not found." });
  if (/^\/(e|i|decide|flags|array|s|static)\//.test(path) || path === "/e/") {
    return sendJson(response, 200, {});
  }
  if (!(await isViteReady())) return sendJson(response, 503, { detail: "Vite is not ready." });
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(bootHtml);
};

createServer((request, response) => void handle(request, response)).listen(port, () => {
  console.log(`posthog app server listening on http://localhost:${port} (vite: ${viteUrl})`);
});
