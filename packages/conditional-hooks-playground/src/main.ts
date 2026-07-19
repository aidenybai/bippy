import { installConditionalHooks } from "bippy/conditional-hooks";

const conditionalHooksInstallation = installConditionalHooks();

const { startApplication } = await import("./app.js");

startApplication(conditionalHooksInstallation);
