import { resolve } from "node:path";
import { Hono } from "hono";
import { handle } from "hono/vercel";
import { ask } from "@/server/analyzer-client";

export const dynamic = "force-dynamic";

const app = new Hono().basePath("/api");

app.onError((error, context) =>
  context.text(error instanceof Error ? (error.stack ?? error.message) : String(error), 500),
);

app.get("/analysis", async (context) => {
  const file = context.req.query("file");
  if (!file) return context.text("Missing file", 400);
  if (context.req.query("format") === "json")
    return context.text(String(await ask({ kind: "json", file: resolve(file) })));
  return Response.json(await ask({ kind: "view", file: resolve(file) }));
});

app.get("/examples", async () => Response.json(await ask({ kind: "examples" })));

export const GET = handle(app);
