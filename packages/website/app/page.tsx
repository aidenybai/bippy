import Image from "next/image";

import { Button } from "@/components/ui/button";
import { FiberTreeDemo } from "@/components/fiber-tree";
import { Link } from "@/components/ui/link";

const Page = () => (
  <main className="mx-auto min-h-screen w-full max-w-2xl space-y-4 px-6 pt-16 pb-12 text-base leading-relaxed font-[425] text-foreground antialiased selection:bg-muted sm:pt-24">
    <div className="flex items-center gap-2">
      <Image
        className="size-8 object-contain"
        src="/icon.png"
        alt=""
        width={32}
        height={32}
        priority
      />
      <p className="text-xl font-medium tracking-tight">bippy</p>
    </div>

    <h1>bippy hacks into React internals.</h1>

    <p>
      React normally keeps its <Link href="https://youtu.be/ZCuYPiUIONs">Fiber tree</Link> out of
      reach. bippy gives you escape hatches to inspect components, track renders, and access the
      renderer directly.
    </p>

    <FiberTreeDemo />

    <div className="flex flex-wrap gap-3 pt-2">
      <Button
        size="lg"
        nativeButton={false}
        render={<a href="https://github.com/aidenybai/bippy#install-bippy">Get started</a>}
      />
      <Button
        variant="secondary"
        size="lg"
        nativeButton={false}
        render={<a href="https://npmjs.com/package/bippy">npm install bippy</a>}
      />
    </div>
  </main>
);

export default Page;
