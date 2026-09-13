import { UncontrolledPopover } from "popover-kit";

export const App = () => (
  <main>
    <button id="edit-task" type="button">
      edit
    </button>
    <UncontrolledPopover target="edit-task">Edit Task</UncontrolledPopover>
  </main>
);
