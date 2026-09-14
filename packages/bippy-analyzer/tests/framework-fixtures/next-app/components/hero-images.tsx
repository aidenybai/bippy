"use client";

import Image from "next/image";

export const HeroImages = (props: { isAboveTheFold: boolean }) => (
  <figure>
    <Image src="/hero.png" alt="hero" width={640} height={320} priority />
    <Image src="/thumb.png" alt="thumb" width={64} height={32} />
    <Image src="/maybe.png" alt="maybe" width={64} height={32} priority={props.isAboveTheFold} />
  </figure>
);
