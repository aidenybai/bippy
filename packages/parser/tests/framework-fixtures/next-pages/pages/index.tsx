import dynamic from "next/dynamic";
import Image from "next/image";

const Widget = dynamic(() => import("../components/widget"), { ssr: false });

export default function Home() {
  return (
    <>
      <h1>Home</h1>
      <Widget />
      <Image src="/hero.png" alt="hero" width={640} height={320} preload />
    </>
  );
}
