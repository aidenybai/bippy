const isRetina = document.createElement("canvas").getContext("2d") !== null;

export const links = () => [
  { rel: "stylesheet", href: "/app.css" },
  { rel: "icon", href: isRetina ? "/icon@2x.png" : "/icon.png" },
];

export const handle = { breadcrumb: isRetina ? "Retina home" : "Home" };

export const meta = () => [
  { title: "Home" },
  { name: "description", content: isRetina ? "Sharp home" : "Home" },
];

export default function Home() {
  return <main>{isRetina ? "retina" : "standard"}</main>;
}
