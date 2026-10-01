import { chromium } from "playwright";
import { documentHtml, documentUrl } from "../fixtures/dom-document.js";

interface BrowserConsoleEntry {
  method: string;
  text: string;
}

export const captureBrowserDOMCounter = async (source: string, commands: readonly string[]) => {
  await using browser = await chromium.launch();
  const page = await browser.newPage();
  const errors: Error[] = [];
  const consoleEntries: BrowserConsoleEntry[] = [];
  page.on("pageerror", (error) => {
    errors.push(error);
  });
  page.on("console", (message) => {
    consoleEntries.push({ method: message.type(), text: message.text() });
  });
  try {
    await page.route("**/*", (route) =>
      route.request().url() === documentUrl
        ? route.fulfill({ contentType: "text/html", body: documentHtml })
        : route.abort(),
    );
    await page.goto(documentUrl);
    await page.addScriptTag({ content: source });
    const observations: string[] = [];
    for (const command of commands) {
      const commits = await page.evaluate<number>("fixture.commits");
      await page.evaluate(`fixture.${command}`);
      if (command !== "unmount()") {
        const checkpoint = await page.waitForFunction(
          `fixture.commits > ${commits} || fixture.errors.length > 0`,
          undefined,
          { timeout: 10_000 },
        );
        await checkpoint.dispose();
      }
      observations.push(await page.evaluate<string>("fixture.observe()"));
    }
    return { observations, errors, consoleEntries, version: browser.version() };
  } catch (error) {
    throw new AggregateError([error, ...errors], "Browser counter capture failed", {
      cause: consoleEntries,
    });
  }
};
