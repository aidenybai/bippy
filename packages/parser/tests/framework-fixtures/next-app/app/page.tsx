import { Counter } from "@/components/counter";
import { Sonner, Toaster } from "@/components/toaster";
import { getGreeting } from "@/lib/greeting";

export default async function HomePage() {
  const greeting = await getGreeting();
  return (
    <section>
      <h1>{greeting}</h1>
      <Counter initial={1} />
      <Toaster />
      <Sonner />
    </section>
  );
}
