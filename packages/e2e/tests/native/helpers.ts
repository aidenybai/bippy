import { by, device, element } from "detox";

// detox auto-synchronization waits for the app to go fully idle before every
// interaction, but a dev-mode RN app never idles (Metro HMR socket, dev
// timers), which inflates each assertion to multiple seconds. The result rows
// are static once the fixture's sentinel row exists, so the specs disable
// sync and rely on explicit waitFor polling instead.
export const launchFixtureApp = async (newInstance: boolean) => {
  await device.launchApp({
    launchArgs: { detoxEnableSynchronization: 0 },
    newInstance,
  });
};

export const readElementText = async (testId: string): Promise<string> => {
  const attributes = await element(by.id(testId)).getAttributes();
  return "text" in attributes && typeof attributes.text === "string" ? attributes.text : "";
};
