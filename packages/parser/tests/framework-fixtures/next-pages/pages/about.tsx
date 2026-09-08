import Head from "next/head";
import Link from "next/link";

export default function About() {
  return (
    <section>
      <Head>
        <title>About</title>
      </Head>
      <Link href="/">
        <a>Home</a>
      </Link>
      <Link href="/posts/1">Post</Link>
    </section>
  );
}
