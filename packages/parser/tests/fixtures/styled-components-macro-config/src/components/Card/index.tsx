import { Heading, Wrapper } from "./style";

export const Card = ({ title }: { title: string }) => (
  <Wrapper>
    <Heading>{title}</Heading>
  </Wrapper>
);
