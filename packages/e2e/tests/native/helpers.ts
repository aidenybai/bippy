import { by, device, element, waitFor } from "detox";

const LAUNCH_ATTEMPT_COUNT = 2;
const SENTINEL_TIMEOUT_MS = 180_000;

const focusAndroidApp = async (): Promise<void> => {
  if (device.getPlatform() !== "android") return;

  // HACK: Headless Android emulators can resume the app without granting its window focus.
  await device.sendToHome();
  await device.launchApp({ newInstance: false });
};

export const launchFixtureApp = async (newInstance: boolean, sentinelTestId: string) => {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < LAUNCH_ATTEMPT_COUNT; attempt++) {
    await device.launchApp({ newInstance: newInstance || attempt > 0 });
    await focusAndroidApp();
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
