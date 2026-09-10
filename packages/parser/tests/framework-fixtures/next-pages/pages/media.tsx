import Head from "next/head";
import Image from "next/image";
import LegacyImage from "next/legacy/image";

export default function Media() {
  return (
    <main>
      <Head>
        <title>Media</title>
      </Head>
      <Image src="/logo.svg" alt="Logo" width={72} height={16} />
      <LegacyImage src="/logo.svg" alt="Logo" width={72} height={16} />
      <LegacyImage src="/hero.png" alt="Hero" layout="fill" priority />
    </main>
  );
}
