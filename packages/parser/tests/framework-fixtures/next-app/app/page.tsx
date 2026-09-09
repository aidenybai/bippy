import { Badge, Card } from "@/components/card";
import { Counter } from "@/components/counter";
import { Sonner, Toaster } from "@/components/toaster";
import { Label, Toggle } from "@/components/toggle";
import { getGreeting } from "@/lib/greeting";

const tagline = <>Static tagline</>;

export default async function HomePage() {
  const greeting = await getGreeting();
  return (
    <section>
      <h1>{greeting}</h1>
      <Counter initial={1} />
      <Card>
        <Badge label="new" />
      </Card>
      <Toaster />
      <Sonner />
      <Toggle />
      <Label text="mode" />
      <h2>{tagline}</h2>
      <h3>{[tagline]}</h3>
    </section>
  );
}
