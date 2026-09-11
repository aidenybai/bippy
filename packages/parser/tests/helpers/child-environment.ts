import { writeFileSync } from "node:fs";
import { createServer } from "node:http";

export interface ChildEnvironment {
  ci: string | null;
  packageManager: string | null;
  port: number | null;
}

const capturePath = process.argv[2];
if (!capturePath) throw new Error("Missing capture path");

const writeEnvironment = (port: number | null): void => {
  const environment: ChildEnvironment = {
    ci: process.env.CI ?? null,
    packageManager: process.env.npm_config_user_agent ?? null,
    port,
  };
  writeFileSync(capturePath, JSON.stringify(environment));
};

if (process.argv[3] === "serve") {
  const server = createServer((_request, response) => response.end("ready"));
  server.listen(Number(process.argv[4] ?? 0), "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing server address");
    writeEnvironment(address.port);
  });
} else {
  writeEnvironment(null);
}
