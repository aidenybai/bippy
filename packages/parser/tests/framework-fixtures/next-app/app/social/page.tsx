import { ClientSocial } from "@/components/client-social";
import { SocialLinks } from "@/components/social-links";
import { ContextIcon } from "@/lib/context-icon";
import { SOCIAL_LINKS } from "@/lib/social";

export default function SocialPage() {
  return (
    <section>
      <SocialLinks links={SOCIAL_LINKS} />
      <ClientSocial />
      <ContextIcon size="2em" />
    </section>
  );
}
