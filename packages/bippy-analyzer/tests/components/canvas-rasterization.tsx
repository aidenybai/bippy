const Painter = () => {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  return context ? <canvas width={canvas.width} /> : <p>no canvas</p>;
};

export default function CanvasRasterization() {
  return (
    <main>
      <Painter />
    </main>
  );
}

export const isPartial = true;
