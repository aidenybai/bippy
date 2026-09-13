export default function ScreenViewport() {
  const isNarrowScreen = window.screen.width <= 800;
  const isViewportWideAsScreen =
    screen.width === window.innerWidth && screen.availHeight === innerHeight;
  return (
    <main>
      {isNarrowScreen ? <nav data-layout="mobile" /> : <nav data-layout="desktop" />}
      <p>
        {isViewportWideAsScreen ? "screen is the viewport" : "screen differs"}
        <em>{window.screen.width}</em>x<em>{window.screen.height}</em>
      </p>
    </main>
  );
}
