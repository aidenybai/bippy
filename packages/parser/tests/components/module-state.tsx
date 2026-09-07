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

const Frame = () => (isEmbedded || isFramed ? <iframe title="embedded" /> : <main>top level</main>);

const Theme = () => (referrerTheme === "dark" ? <b>dark</b> : <i>light</i>);

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
    </div>
  );
}

export const minCoverage = 0.8;
