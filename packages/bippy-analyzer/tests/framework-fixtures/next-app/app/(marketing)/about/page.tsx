import { Badge } from "@/components/badge";
import { Card, CardTitle } from "@/components/card";
import { Badge as ClientBadge } from "@/components/client-badges";
import { ClientLogo } from "@/components/client-logo";
import { Dashboard } from "@/components/dashboard";
import { Logo } from "@/components/logo";

export default function AboutPage() {
  return (
    <main>
      <h1>About</h1>
      <Card>
        <CardTitle>Team</CardTitle>
      </Card>
      <Badge>server</Badge>
      <ClientBadge>client</ClientBadge>
      <Dashboard />
      <Logo />
      <ClientLogo />
    </main>
  );
}
