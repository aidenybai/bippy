let isEmbedded = false;
if (window.self !== window.top) {
  isEmbedded = true;
}

let isFramed = window.parent !== window;

let referrerTheme = "light";
if (document.referrer.includes("theme=dark")) {
  referrerTheme = "dark";
}

let bootCount = 0;
const boot = () => {
  bootCount += 1;
};
boot();
if (document.referrer.length > 0) {
  boot();
} else {
  boot();
}

const providers = [{ id: "credentials" }];
if (document.referrer.includes("provider=oauth")) {
  providers.push({ id: "oauth" });
}
const oauthProviders = providers.filter((provider) => provider.id !== "credentials");

const Frame = () => (isEmbedded || isFramed ? <iframe title="embedded" /> : <main>top level</main>);

const Theme = () => (referrerTheme === "dark" ? <b>dark</b> : <i>light</i>);

const Providers = () => (
  <ul>
    {oauthProviders.length > 0 && <li>oauth</li>}
    <li>credentials</li>
  </ul>
);

const Boots = () => (
  <ol>
    {Array.from({ length: bootCount }, (_, index) => (
      <li key={index}>boot</li>
    ))}
  </ol>
);

export default function ModuleState() {
  return (
    <div>
      <Frame />
      <Theme />
      <Boots />
      <Providers />
    </div>
  );
}

export const minCoverage = 0.8;
