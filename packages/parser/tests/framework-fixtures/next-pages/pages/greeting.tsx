import type { GetServerSideProps } from "next";

interface GreetingProps {
  name: string;
  isReturning: boolean;
}

export const getServerSideProps: GetServerSideProps<GreetingProps> = async () => ({
  props: { name: "Ada", isReturning: true },
});

export default function Greeting({ name, isReturning }: GreetingProps) {
  return (
    <main>
      <h1>Hello, {name}</h1>
      {isReturning ? <p>Welcome back</p> : <aside>First visit</aside>}
    </main>
  );
}
