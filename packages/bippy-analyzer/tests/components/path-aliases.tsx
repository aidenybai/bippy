import { Avatar } from "@shared/avatar";
import * as shared from "@shared/index";
import { Button } from "~/shared/button";

export default function PathAliases() {
  return (
    <div>
      <Avatar name="Alias" />
      <shared.Card>
        <Button>aliased</Button>
      </shared.Card>
    </div>
  );
}
