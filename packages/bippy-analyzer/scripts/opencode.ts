import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { OpenCodeClient } from "@opencode/client";

interface AuditHost extends OpenCodeClient {
  close: () => Promise<void>;
}

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDirectory = resolve(packageDirectory, "../..");
const auditDirectory = join(packageDirectory, ".opencode-audits");
const privateDirectory = join(auditDirectory, "private");
const providerID = "opencode-go";
const modelID = "deepseek-v4.1-flash";
const usage = `pnpm --filter bippy-analyzer opencode run <name> <prompt-file>
pnpm --filter bippy-analyzer opencode status <name>
pnpm --filter bippy-analyzer opencode approve|reject <name> <request-id>
pnpm --filter bippy-analyzer opencode abort <name>

Repeat run with the same name to send a follow-up in the same session.
Runs stop after 30 minutes. Generated files live in .opencode-audits/<name>/artifacts.`;

const validateName = (name: string) => {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(name) || name === "private") {
    throw new Error("Use a lowercase kebab-case run name (not private).");
  }
  return name;
};

const writeText = async (path: string, value: string) => {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, value, { mode: 0o600 });
  await rename(temporaryPath, path);
};

const writeJson = (path: string, value: unknown) =>
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));

const getLegacyKey = async () => {
  const dataDirectory = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  let credentials: unknown;
  try {
    credentials = await readJson(join(dataDirectory, "opencode", "auth.json"));
  } catch {
    throw new Error("Connect OpenCode Go first, or set OPENCODE_API_KEY.");
  }
  if (typeof credentials === "object" && credentials !== null && providerID in credentials) {
    const credential: unknown = Reflect.get(credentials, providerID);
    if (
      typeof credential === "object" &&
      credential !== null &&
      "type" in credential &&
      credential.type === "api" &&
      "key" in credential &&
      typeof credential.key === "string" &&
      credential.key
    ) {
      return credential.key;
    }
  }
  throw new Error("No OpenCode Go API credential found. Set OPENCODE_API_KEY.");
};

const run = async (name: string, promptPath: string) => {
  const text = await readFile(resolve(promptPath), "utf8");
  if (!text.trim()) throw new Error("Prompt file is empty.");
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
  const lockPath = join(privateDirectory, "runner.lock");
  try {
    await writeFile(lockPath, String(process.pid), { flag: "wx", mode: 0o600 });
  } catch {
    throw new Error(
      `Another runner may be active. Check ${lockPath} before removing a stale lock.`,
    );
  }
  try {
    const runDirectory = join(auditDirectory, name);
    const artifactsDirectory = join(runDirectory, "artifacts");
    const repliesDirectory = join(runDirectory, "replies");
    await mkdir(artifactsDirectory, { recursive: true, mode: 0o700 });
    await mkdir(repliesDirectory, { recursive: true, mode: 0o700 });
    await rm(join(runDirectory, "abort"), { force: true });
    const catalogPath = join(privateDirectory, "models.json");
    const response = await fetch("https://models.dev/api.json", {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Model catalog HTTP ${response.status}`);
    await writeJson(catalogPath, await response.json());
    const { OpenCode } = await import("@opencode/sdk");
    const host: AuditHost = await OpenCode.create({
      database: { path: join(privateDirectory, "host.db") },
      models: { file: catalogPath, fetch: false },
      config: { directory: join(privateDirectory, "config"), project: false, content: "{}" },
      fs: { filewatcher: false, fff: false },
    });
    let sessionID: string | undefined;
    let isInterrupted = false;
    const eventAbort = new AbortController();
    let eventCollection: Promise<void> | undefined;
    const interrupt = () => {
      isInterrupted = true;
    };
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", interrupt);
    try {
      const location = { directory: repositoryDirectory };
      await host.location.get({ location });
      const initializationDeadline = Date.now() + 30_000;
      while (
        !(await host.integration.list({ location })).data.some(
          (integration) => integration.id === providerID,
        )
      ) {
        if (isInterrupted || Date.now() > initializationDeadline)
          throw new Error("OpenCode Go initialization timed out.");
        await delay(100);
      }
      const integration = await host.integration.get({ location, integrationID: providerID });
      if (!integration.data.connections.length && !process.env.OPENCODE_API_KEY) {
        const key = await getLegacyKey();
        try {
          await host.integration.connect.key({ location, integrationID: providerID, key });
        } catch {
          throw new Error("Could not connect the existing OpenCode Go credential.");
        }
      }
      const modelDeadline = Date.now() + 30_000;
      while (
        !(await host.model.list({ location })).data.some(
          (model) => model.providerID === providerID && model.id === modelID && model.enabled,
        )
      ) {
        if (isInterrupted || Date.now() > modelDeadline)
          throw new Error(`Model unavailable: ${providerID}/${modelID}`);
        await delay(100);
      }
      const sessionPath = join(runDirectory, "session-id");
      if ((await readdir(runDirectory)).includes("session-id")) {
        sessionID = (await readFile(sessionPath, "utf8")).trim();
        await host.session.get({ sessionID });
      } else {
        const session = await host.session.create({
          location,
          title: `bippy-analyzer: ${name}`,
          model: { providerID, id: modelID },
          permissions: [
            { action: "*", resource: "*", effect: "ask" },
            { action: "read", resource: "*", effect: "allow" },
            { action: "glob", resource: "*", effect: "allow" },
            { action: "grep", resource: "*", effect: "allow" },
            { action: "edit", resource: "*", effect: "deny" },
            { action: "edit", resource: `${artifactsDirectory}/*`, effect: "allow" },
            {
              action: "edit",
              resource: `packages/bippy-analyzer/.opencode-audits/${name}/artifacts/*`,
              effect: "allow",
            },
            { action: "read", resource: "*.env*", effect: "deny" },
            { action: "read", resource: "*auth.json", effect: "deny" },
            { action: "read", resource: "*.opencode-audits/private/*", effect: "deny" },
            { action: "task", resource: "*", effect: "deny" },
            { action: "question", resource: "*", effect: "deny" },
          ],
        });
        sessionID = session.id;
        await writeFile(sessionPath, sessionID, { mode: 0o600 });
      }
      const sessionInput = { sessionID };
      const toolInputs = new Map<string, Record<string, unknown>>();
      const events = host.event.subscribe({ signal: eventAbort.signal })[Symbol.asyncIterator]();
      await events.next();
      eventCollection = (async () => {
        for (let next = await events.next(); !next.done; next = await events.next()) {
          const event = next.value;
          if (event.type === "session.tool.called" && event.data.sessionID === sessionID) {
            toolInputs.set(event.data.id, event.data.input);
          }
          if (event.type === "session.tool.input.ended" && event.data.sessionID === sessionID) {
            try {
              const input: unknown = JSON.parse(event.data.text);
              if (input && typeof input === "object" && !Array.isArray(input)) {
                toolInputs.set(event.data.id, Object.fromEntries(Object.entries(input)));
              }
            } catch {
              continue;
            }
          }
        }
      })().catch(() => {
        if (!eventAbort.signal.aborted) {
          console.error("OpenCode event stream failed.");
          isInterrupted = true;
        }
      });
      const prompt = `Work in ${repositoryDirectory}. Write diagnostic files only inside ${artifactsDirectory}. Do not modify production code, existing tests, package files, or expectations. Never read credentials or private controller files. Shell requests require supervisor approval.\n\n${text}`;
      await writeFile(join(runDirectory, `prompt-${Date.now()}.md`), prompt, { mode: 0o600 });
      await host.session.prompt({ ...sessionInput, text: prompt });
      console.log(`Session ${sessionID}; artifacts: ${artifactsDirectory}`);
      const deadline = Date.now() + 30 * 60_000;
      let isFinished = false;
      let completionError: unknown;
      const completion = host.session.wait(sessionInput).then(
        () => {
          isFinished = true;
        },
        (error: unknown) => {
          completionError = error;
          isFinished = true;
        },
      );
      const announcedPermissions = new Set<string>();
      try {
        do {
          const permissions = (await host.permission.list(sessionInput)).map((permission) => ({
            ...permission,
            input: permission.source ? toolInputs.get(permission.source.id) : undefined,
          }));
          const exported = await host.session.export(sessionInput);
          await writeJson(join(runDirectory, "session.json"), exported);
          await writeJson(join(runDirectory, "status.json"), {
            sessionID,
            pid: process.pid,
            updatedAt: new Date().toISOString(),
            isRunning: !isFinished,
            outcome: isFinished ? exported.info.outcome : undefined,
            permissions,
          });
          for (const permission of permissions) {
            if (!announcedPermissions.has(permission.id)) {
              console.log(JSON.stringify(permission, null, 2));
              announcedPermissions.add(permission.id);
            }
            const replyPath = join(repliesDirectory, permission.id);
            if (!(await readdir(repliesDirectory)).includes(permission.id)) continue;
            const decision = (await readFile(replyPath, "utf8")).trim();
            if (decision !== "once" && decision !== "reject")
              throw new Error("Invalid permission reply.");
            if (decision === "once" && permission.action === "shell" && !permission.input) {
              throw new Error(
                "Cannot approve shell request without its full input. Reject it instead.",
              );
            }
            try {
              await host.permission.reply({ ...sessionInput, requestID: permission.id, decision });
            } catch {
              console.error(`Permission ${permission.id} expired or could not be answered.`);
            }
            await rm(replyPath);
          }
          if (
            isInterrupted ||
            Date.now() > deadline ||
            (await readdir(runDirectory)).includes("abort")
          ) {
            await host.session.interrupt({ ...sessionInput, resume: false });
            await completion;
          }
          if (!isFinished) await delay(1000);
        } while (!isFinished);
        await completion;
        if (completionError) throw completionError;
      } finally {
        await host.session.interrupt({ ...sessionInput, resume: false });
        const exported = await host.session.export(sessionInput);
        await writeJson(join(runDirectory, "session.json"), exported);
        await writeJson(join(runDirectory, "status.json"), {
          sessionID,
          updatedAt: new Date().toISOString(),
          isRunning: false,
          outcome: exported.info.outcome,
          permissions: [],
        });
        const lastAssistant = exported.messages.findLast((message) => message.type === "assistant");
        for (const content of lastAssistant?.content ?? []) {
          if (content.type === "text") console.log(content.text);
        }
        console.log(`Outcome: ${exported.info.outcome ?? "unknown"}`);
        if (exported.info.outcome !== "succeeded") process.exitCode = 1;
      }
    } finally {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", interrupt);
      eventAbort.abort();
      await eventCollection;
      await host.close();
    }
  } finally {
    await rm(lockPath, { force: true });
  }
};

const main = async () => {
  const [command, rawName, argument, ...extra] = process.argv.slice(2);
  if (!command || command === "--help") {
    console.log(usage);
    return;
  }
  if (!rawName || extra.length) throw new Error(usage);
  const name = validateName(rawName);
  const runDirectory = join(auditDirectory, name);
  if (command === "run" && argument) return run(name, argument);
  if (command === "status" && !argument) {
    console.log(await readFile(join(runDirectory, "status.json"), "utf8"));
    return;
  }
  if (command === "abort" && !argument) {
    await writeFile(join(runDirectory, "abort"), "", { mode: 0o600 });
    return;
  }
  if (
    (command === "approve" || command === "reject") &&
    argument &&
    /^[a-zA-Z0-9_-]+$/.test(argument)
  ) {
    await writeText(
      join(runDirectory, "replies", argument),
      command === "approve" ? "once" : "reject",
    );
    return;
  }
  throw new Error(usage);
};

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "OpenCode request failed; inspect the session export.",
  );
  process.exitCode = 1;
});
