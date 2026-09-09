import Image from "next/image";
import { memo } from "react";

export const Hero = memo(() => (
  <header>
    <Image src="/hero.png" alt="hero" width={640} height={320} priority />
    <Image src="/thumb.png" alt="thumb" width={64} height={32} />
  </header>
));
