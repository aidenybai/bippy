import { afterAll, afterEach, beforeAll } from "vite-plus/test";
import {
  flushNodeCoverage,
  startNodeCoverageSession,
  stopNodeCoverageSession,
  type NodeCoverageSession,
} from "./node-fixture.js";

export const setupVitestCoverage = (rawDir: string): void => {
  let session: NodeCoverageSession | null = null;

  beforeAll(async () => {
    session = await startNodeCoverageSession();
  });

  afterEach(async () => {
    if (!session) return;
    try {
      await flushNodeCoverage(session.session, rawDir, session.sourceCache);
    } catch {
      // ignore: coverage is best-effort
    }
  });

  afterAll(async () => {
    if (!session) return;
    await stopNodeCoverageSession(session.session);
    session = null;
  });
};
