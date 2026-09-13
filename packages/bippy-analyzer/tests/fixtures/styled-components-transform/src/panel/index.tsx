import { styled } from "styled-components";

const slots = {
  Frame: styled.section`
    padding: 1rem;
  `,
};

export const Panel = () => <slots.Frame>panel</slots.Frame>;
