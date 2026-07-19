import { installConditionalHooks } from "bippy/conditional-hooks";

const conditionalHooksInstallation = installConditionalHooks({
  interceptReactHooks: true,
});

const { startApplication } = await import("./app.js");

startApplication(conditionalHooksInstallation);
