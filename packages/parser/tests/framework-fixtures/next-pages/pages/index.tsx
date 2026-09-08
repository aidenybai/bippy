import dynamic from "next/dynamic";

const Widget = dynamic(() => import("../components/widget"), { ssr: false });

export default function Home() {
  return (
    <>
      <h1>Home</h1>
      <Widget />
    </>
  );
}
