import { by, device, element, waitFor } from "detox";

const LAUNCH_ATTEMPT_COUNT = 2;
const SENTINEL_TIMEOUT_MS = 180_000;

// the first cold launch on CI simulators occasionally hangs before the app
// ever requests its JS bundle from Metro (observed across runs: the retry
// launch always recovers), so treat launch + readiness as one retryable unit.
// synchronization is disabled after launch because a dev-mode RN app never
// fully idles (Metro HMR socket, dev timers), which inflates every synced
// assertion to multiple seconds
export const launchFixtureApp = async (newInstance: boolean, sentinelTestId: string) => {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < LAUNCH_ATTEMPT_COUNT; attempt++) {
    await device.launchApp({ newInstance: newInstance || attempt > 0 });
    await device.disableSynchronization();
    try {
      await waitFor(element(by.id(sentinelTestId)))
        .toExist()
        .withTimeout(SENTINEL_TIMEOUT_MS);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
};

export const readElementText = async (testId: string): Promise<string> => {
  const attributes = await element(by.id(testId)).getAttributes();
  return "text" in attributes && typeof attributes.text === "string" ? attributes.text : "";
};
