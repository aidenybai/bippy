import greeting from "greeting.macro";

Reflect.set(globalThis, "__bippyMacroApplicationRan", true);

export default () => <main>value: {greeting}</main>;
