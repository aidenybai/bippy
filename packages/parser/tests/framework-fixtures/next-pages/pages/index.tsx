import dynamic from "next/dynamic";
import Image from "next/image";
import { useRouter } from "next/router";

const Widget = dynamic(() => import("../components/widget"), { ssr: false });

export default function Home() {
  const router = useRouter();
  return (
    <>
      <h1>Home</h1>
      <Widget />
      <Image src="/hero.png" alt="hero" width={640} height={320} preload />
      {router.pathname === "/" ? <code>root</code> : <s>elsewhere</s>}
    </>
  );
}
