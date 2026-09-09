let epoch = 0;
const bump = (): void => {
  epoch++;
};

const canRenderP3 = typeof CSS !== "undefined" && CSS.supports("color", "color(display-p3 1 1 1)");
const supportsHas = typeof CSS !== "undefined" && CSS.supports("selector(:has(a))");
const gamut = canRenderP3 ? window.matchMedia("(color-gamut: p3)") : null;
const hasWideGamut = gamut !== null && gamut.matches;
if (hasWideGamut) bump();
bump();
const isWide = window.matchMedia("(min-width: 600px)").matches;
const printsInColor = window.matchMedia("print and (color)").matches;

export const App = () => (
  <main data-epoch={epoch} data-has={supportsHas ? "yes" : "no"}>
    {epoch === 1 ? <em>sRGB</em> : <strong>P3</strong>}
    {isWide ? <nav>wide</nav> : <nav>narrow</nav>}
    {printsInColor ? <p>color print</p> : <p>mono print</p>}
  </main>
);
