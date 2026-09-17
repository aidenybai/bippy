import { actions, afterMount, kea, key, path, props, reducers } from "kea";

export interface ItemLogicProps {
  id: string;
}

export const itemLogic = kea([
  props({} as ItemLogicProps),
  key((logicProps) => logicProps.id),
  path((logicKey) => ["scenes", "item", logicKey]),
  actions({ setLabel: (label: string) => ({ label }) }),
  reducers({ label: ["untitled", { setLabel: (_, { label }) => label }] }),
  afterMount(({ actions, props }) => actions.setLabel(`item ${props.id}`)),
]);
