import { type FC, memo } from "react";
import { Testimonial, TimelineItem, timeline } from "./shared/timeline-types";

const TimelineItem: FC<{ item: TimelineItem }> = memo(({ item }) => (
  <li>
    <b>{item.title}</b> <i>{item.date}</i>
  </li>
));
TimelineItem.displayName = "TimelineItem";

function Testimonial({ testimonial }: { testimonial: Testimonial }) {
  return <blockquote>{testimonial.text}</blockquote>;
}

export default function TypeImportShadowedByDeclaration() {
  return (
    <section>
      <ul>
        {timeline.map((item) => (
          <TimelineItem item={item} key={item.title} />
        ))}
      </ul>
      <Testimonial testimonial={{ name: "Ada", text: "Works." }} />
    </section>
  );
}
