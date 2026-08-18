import { createServer } from "node:net";

export const getFreePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probeServer = createServer();
    probeServer.once("error", reject);
    probeServer.listen(0, "127.0.0.1", () => {
      const address = probeServer.address();
      if (address === null || typeof address === "string") {
        reject(new Error("could not determine a free port"));
        return;
      }
      probeServer.close(() => resolve(address.port));
    });
  });

export const waitForServer = async (url: string, timeoutMs = 30_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 250));
  }
  throw new Error(`dev server did not become ready at ${url}`);
};
