import Image from "next/image";

export default function Gallery() {
  return (
    <figure>
      <Image src="/hero.png" alt="hero" width={640} height={320} priority />
      <Image src="/thumb.png" alt="thumb" width={64} height={32} />
    </figure>
  );
}
