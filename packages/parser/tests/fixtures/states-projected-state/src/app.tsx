import { useLayoutEffect, useState } from "react";

const Indicator = ({ status }: { status: string }) =>
  status !== "idle" ? <hr /> : <progress />;

const Caption = ({ status }: { status: string }) =>
  status !== "idle" ? <output>ready</output> : <small>waiting</small>;

export const App = () => {
  const [status, setStatus] = useState("idle");
  useLayoutEffect(() => {
    const image = new window.Image();
    const handleLoad = () => setStatus("loaded");
    const handleError = () => setStatus("error");
    image.addEventListener("load", handleLoad);
    image.addEventListener("error", handleError);
    image.src = "/picture.png";
    return () => {
      image.removeEventListener("load", handleLoad);
      image.removeEventListener("error", handleError);
    };
  }, []);
  return (
    <section>
      <Indicator status={status} />
      <Caption status={status} />
    </section>
  );
};
