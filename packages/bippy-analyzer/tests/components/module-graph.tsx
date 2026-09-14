import { Avatar } from "./shared";
import * as Shared from "./shared";
import Panel from "./shared/panel";
import { Card as RenamedCard } from "./shared/card";

export default function ModuleGraph() {
  return (
    <div>
      <Avatar name="ada" />
      <Shared.Avatar name="bob" size="large" />
      <Shared.Card>
        <Panel title="panel" />
      </Shared.Card>
      <RenamedCard>renamed</RenamedCard>
    </div>
  );
}
