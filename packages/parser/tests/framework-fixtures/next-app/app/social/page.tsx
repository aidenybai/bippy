import { ClientSocial } from "@/components/client-social";
import { SocialLinks } from "@/components/social-links";
import { SOCIAL_LINKS } from "@/lib/social";

export default function SocialPage() {
  return (
    <section>
      <SocialLinks links={SOCIAL_LINKS} />
      <ClientSocial />
    </section>
  );
}
