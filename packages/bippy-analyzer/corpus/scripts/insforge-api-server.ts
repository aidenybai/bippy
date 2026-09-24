// Stands in for the InsForge Express backend (`backend/src/server.ts`) for an
// anonymous dashboard visit: answers the admin session probes the way
// `verifyToken` / the `/refresh` route do without credentials, so the frontend
// lands on `/dashboard/login`. Everything else is 404 like an unknown route.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const port = Number(process.env.INSFORGE_API_PORT ?? 7130);

interface ErrorBody {
  error: string;
  message: string;
  statusCode: number;
  nextActions?: string;
}

const sendJson = (response: ServerResponse, statusCode: number, body: ErrorBody): void => {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
};

const handle = (request: IncomingMessage, response: ServerResponse): void => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
  if (request.method === "GET" && url.pathname === "/api/auth/admin/sessions/current") {
    sendJson(response, 401, {
      error: "AUTH_INVALID_CREDENTIALS",
      message: "No token provided",
      statusCode: 401,
      nextActions: "Check the token is valid or login to get a new token.",
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/auth/admin/refresh") {
    sendJson(response, 401, {
      error: "AUTH_UNAUTHORIZED",
      message: "No admin refresh token provided",
      statusCode: 401,
    });
    return;
  }
  sendJson(response, 404, {
    error: "NOT_FOUND",
    message: `Endpoint ${url.pathname} not found`,
    statusCode: 404,
    nextActions: "Please check the API documentation for available endpoints",
  });
};

createServer(handle).listen(port, () => {
  console.log(`insforge stand-in api listening on :${port}`);
});
