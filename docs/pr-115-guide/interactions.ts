interface TraceStep {
  title: string;
  state: string;
  output: string;
  explanation: string;
  line?: number;
}

interface TraceController {
  reset: () => void;
}

const getElement = <ElementType extends Element = HTMLElement>(
  selector: string,
  parent: ParentNode = document,
): ElementType => {
  const element = parent.querySelector<ElementType>(selector);
  if (!element) throw new Error(`Missing guide element: ${selector}`);
  return element;
};

const getElements = <ElementType extends Element = HTMLElement>(
  selector: string,
  parent: ParentNode = document,
): ElementType[] => Array.from(parent.querySelectorAll<ElementType>(selector));

const setPressed = (selector: string, selected: HTMLButtonElement): void => {
  for (const button of getElements<HTMLButtonElement>(selector)) {
    button.setAttribute("aria-pressed", String(button === selected));
  }
};

const executionSteps: TraceStep[] = [
  {
    title: "An element is a description",
    state:
      "canEdit → unknown Boolean\nhook frame → not initialized\nview → not allocated\ntasks → empty",
    output: "AccessPanel element\nprops: { canEdit: unknown }\n\nIts body has not run.",
    explanation:
      "Creating an element records its type and props. The materializer gives React a proxy for AccessPanel. React invokes the proxy, which asks the interpreter to evaluate AccessPanel’s body.",
  },
  {
    title: "Evaluate the body and its conditional mutation",
    state:
      "cell 0: current = false\nview → object A\nA.mode = canEdit ? 'edit' : 'read'\neffect callback recorded\ntasks → empty",
    output: "The proxy is rendering.\n\nNo effect has run yet.\nNo timer has been registered.",
    explanation:
      "The first state hook allocates its persistent cell. The local object is allocated for this render. The true path writes 'edit'; the false path retains 'read'. Joining those stores leaves one object with a conditional field. The effect captures this render’s environment.",
  },
  {
    title: "Turn the returned values into React nodes",
    state:
      "canEdit → still unknown\nisReady → false\nview.mode → conditional\nregistered tasks → none",
    output: "AccessPanel → main\n  $Branch(canEdit)\n    true:  button\n    false: p\n  span",
    explanation:
      "The known false state selects span immediately. The unknown canEdit keeps two alternatives for the other child. React reconciles their materialized nodes beneath internal markers. Those markers carry a choice, not a claim that the original page displays both alternatives.",
  },
  {
    title: "Commit the initial tree, then invoke the effect",
    state: "cell 0: current = false\ntimer 1: registered under canEdit\ncallback: setReady(true)",
    output: "Initial possibilities\n\ncanEdit  → button + span\n!canEdit → p + span",
    explanation:
      "The passive phase invokes the modeled effect callback. Its condition is interpreted. The timer exists only on the edit path, and its registration retains that cause after the callback returns.",
  },
  {
    title: "Run the timer as a guarded mutation",
    state:
      "timer 1: consumed\nactive condition: canEdit\ncurrent state: false\nnext state: true under canEdit\nproxy render requested",
    output:
      "The existing committed tree\nis still the current output.\n\nA pending setter is not a\nrewrite of old local variables.",
    explanation:
      "The timer updates the persistent cell under its registration condition. The no-edit path keeps false. Calling the proxy’s real React setter requests another render, but the earlier function call’s isReady binding remains false.",
  },
  {
    title: "Read persistent state in a new function activation",
    state:
      "pending state applied\nhook cursors reset\nnew local bindings\nnew view object\nsame persistent state cell",
    output: "Later tree under canEdit\n\nmain → button + strong\n\nNo read-only ready transition.",
    explanation:
      "The interpreter evaluates the body again with the same hook frame. Local allocations happen again; the hook initializer does not reset the existing cell. The update’s cause constrains the later commit, keeping the ready branch associated with canEdit.",
  },
  {
    title: "Preserve the structures and the conditions that connect them",
    state:
      "input relationship retained\ninitial and later commits retained\nno remaining task in this example",
    output:
      "!canEdit: p + span\ncanEdit:  button + span\n          → button + strong\n\nExcluded: p + strong",
    explanation:
      "The tree reader turns internal markers back into guarded patterns. The cause on the later commit prevents mixing its ready state with the no-edit input. The representation keeps why a structure can appear, not just a list of element names.",
  },
];

const mutationSteps: TraceStep[] = [
  {
    title: "Record the fork’s starting point",
    state: "state → object A\nalias → object A\nA.count = 0",
    output: "Entry allocation recorded.\nNo path has written A yet.",
    explanation:
      "Both names reference A. The journal records A’s original contents when the first write touches it. Copying the scope’s two references would not copy or restore A.",
    line: 0,
  },
  {
    title: "Evaluate the true path",
    state: "active path: flag\nstate → object A\nalias → object A\nA.count = 1",
    output: "Original contents: count = 0\nTrue-path contents: count = 1",
    explanation:
      "The write through alias changes the same object reached through state. The journal is keyed by that object identity, not by the variable spelling used in the assignment.",
    line: 1,
  },
  {
    title: "Save the path result and restore the entry state",
    state: "state → object A\nalias → object A\nA.count = 0",
    output: "Saved under flag: count = 1\nRestored for sibling: count = 0",
    explanation:
      "endPath retains the state the true path left, then restores the original object entries. The false path has not executed yet. This restoration is interpreter bookkeeping, not another statement in the application.",
  },
  {
    title: "Evaluate the false path from the same entry state",
    state: "active path: !flag\nstate → object A\nalias → object A\nA.count = 2",
    output: "Saved under flag: count = 1\nFalse-path contents: count = 2",
    explanation:
      "The sibling starts from zero, not from the earlier path’s one. Its write is recorded as a different execution outcome rather than appended to the true path’s history.",
    line: 3,
  },
  {
    title: "Join the contents without replacing object identity",
    state: "state → object A\nalias → object A\nA.count = flag ? 1 : 2",
    output: "Returned value\n  1 under flag\n  2 under !flag\n\nstate === alias remains true",
    explanation:
      "The journal joins the recorded contents into a conditional field. All existing references still reach A. The condition on the field remains available to code that reads it later.",
    line: 4,
  },
];

const taskSteps: TraceStep[] = [
  {
    title: "The synchronous body finishes",
    state: "microtasks: promise reaction, explicit microtask\ntimers: timer callback",
    output: "sync",
    explanation:
      "Calling then registered a reaction. It did not invoke that callback inline. The synchronous push happens before the queued work.",
  },
  {
    title: "Run the promise reaction",
    state: "microtasks: explicit microtask, nested microtask\ntimers: timer callback",
    output: "sync → promise",
    explanation:
      "The reaction appends 'promise' to the trace and queues another microtask. The nested callback goes behind the explicit microtask that was already waiting.",
  },
  {
    title: "Run the already waiting microtask",
    state: "microtasks: nested microtask\ntimers: timer callback",
    output: "sync → promise → microtask",
    explanation:
      "The explicit microtask runs before the newer nested one. Looking only at the nesting of callback bodies would suggest the wrong order.",
  },
  {
    title: "Drain the nested microtask",
    state: "microtasks: empty\ntimers: timer callback",
    output: "sync → promise → microtask → nested",
    explanation:
      "The reaction’s nested work now runs. This drains the modeled microtask queue before the eligible zero-delay timer callback is advanced.",
  },
  {
    title: "Run the timer",
    state: "microtasks: empty\ntimers: empty",
    output: "sync → promise → microtask → nested → timer",
    explanation:
      "The timer appends the final entry. This trace models the stated queue operations; it is not a complete browser event-loop simulator or a model of every React scheduling priority.",
  },
];

let isFunctionalUpdate = false;
const getUpdateSteps = (): TraceStep[] => {
  const finalValue = isFunctionalUpdate ? 2 : 1;
  return [
    {
      title: "The callback was created by a render",
      state: "current = 0\nnext = none",
      output: "captured count = 0\nsetCount → the persistent cell",
      explanation:
        "Its count binding is 0. Calling the setter changes pending hook state, not this captured binding.",
    },
    {
      title: "Compute the first pending update",
      state: "current = 0\nnext = 1",
      output: "captured count = 0\nsetCount → the persistent cell",
      explanation: isFunctionalUpdate
        ? "The updater receives cell.next ?? cell.current, which is 0. Interpreting value + 1 produces 1, which becomes the pending state."
        : "The callback evaluates count + 1 using its captured zero. It supplies the replacement value 1 to the setter.",
    },
    {
      title: "Compute the second pending update",
      state: `current = 0\nnext = ${finalValue}`,
      output: "captured count = 0\nsetCount → the persistent cell",
      explanation: isFunctionalUpdate
        ? "The second updater receives the pending value 1, not the callback’s captured count. Its result is 2."
        : "The callback evaluates count + 1 again using the same captured zero. It supplies 1 again. This does not increment the pending value to 2.",
    },
    {
      title: "Apply pending state for the next proxy render",
      state: `current = ${finalValue}\nnext = none`,
      output: `old callback’s count = 0\nnew render’s count = ${finalValue}\nsetCount → the same cell`,
      explanation:
        "The hook pass applies the pending value and the next evaluation reads it into fresh locals. The original callback’s binding does not change. A newly created callback can capture the new render’s value.",
    },
  ];
};

const createTrace = (name: string, getSteps: () => TraceStep[]): TraceController => {
  const container = getElement(`[data-trace="${name}"]`);
  let index = 0;
  const render = (): void => {
    const steps = getSteps();
    const step = steps[index];
    getElement("[data-step-count]", container).textContent = `Step ${index + 1} of ${steps.length}`;
    getElement("[data-state]", container).textContent = step.state;
    getElement("[data-output]", container).textContent = step.output;
    const heading = document.createElement("h4");
    heading.textContent = `${index + 1}. ${step.title}`;
    const paragraph = document.createElement("p");
    paragraph.textContent = step.explanation;
    getElement("[data-explanation]", container).replaceChildren(heading, paragraph);
    getElement<HTMLButtonElement>("[data-back]", container).disabled = index === 0;
    getElement<HTMLButtonElement>("[data-next]", container).disabled = index === steps.length - 1;
    for (const line of getElements("[data-code-line]", container)) {
      line.classList.toggle("active-line", Number(line.dataset.codeLine) === step.line);
    }
  };
  const reset = (): void => {
    index = 0;
    render();
  };
  getElement("[data-next]", container).addEventListener("click", () => {
    index = Math.min(getSteps().length - 1, index + 1);
    render();
  });
  getElement("[data-back]", container).addEventListener("click", () => {
    index = Math.max(0, index - 1);
    render();
  });
  getElement("[data-reset]", container).addEventListener("click", reset);
  render();
  return { reset };
};

createTrace("execution", () => executionSteps);
createTrace("mutation", () => mutationSteps);
createTrace("tasks", () => taskSteps);
const updateTrace = createTrace("updates", getUpdateSteps);
for (const button of getElements<HTMLButtonElement>("[data-update]")) {
  button.addEventListener("click", () => {
    isFunctionalUpdate = button.dataset.update === "updater";
    setPressed("[data-update]", button);
    updateTrace.reset();
  });
}

for (const button of getElements<HTMLButtonElement>("[data-value]")) {
  button.addEventListener("click", () => {
    const selected = button.dataset.value;
    setPressed("[data-value]", button);
    getElement("#value-count").textContent =
      selected === "unknown" ? "2 when flag\n3 when !flag" : selected === "true" ? "2" : "3";
    getElement("#value-result").textContent =
      selected === "unknown" ? "4 when flag\n6 when !flag" : selected === "true" ? "4" : "6";
    getElement("#value-explanation").textContent =
      selected === "unknown"
        ? "Multiplication changes each numeric alternative but retains the condition selecting it."
        : "The known condition selects one value. The multiplication can produce one concrete result without a branch.";
  });
}

const closureMutation = getElement<HTMLInputElement>("#closure-mutation");
closureMutation.addEventListener("change", () => {
  getElement("#closure-result").textContent = closureMutation.checked ? "after" : "before";
  getElement("#closure-explanation").textContent = closureMutation.checked
    ? "The function reads object A when called. Its captured reference still reaches A after A’s contents change."
    : "Without the write, object A still holds 'before'. The closure reads the object at call time; it did not precompute the property when it was created.";
});

for (const button of getElements<HTMLButtonElement>("[data-role]")) {
  button.addEventListener("click", () => {
    const role = button.dataset.role;
    setPressed("[data-role]", button);
    getElement("#guard-conditions").textContent =
      role === "unknown"
        ? 'button present: eq(role, "admin")\na present:      eq(role, "admin")'
        : `button condition: ${role === "admin"}\na condition:      ${role === "admin"}`;
    getElement("#guard-output").textContent =
      role === "unknown"
        ? "button + a\nneither\n\nNever just one of them."
        : role === "admin"
          ? "button + a"
          : "neither";
    getElement("#guard-explanation").textContent =
      role === "unknown"
        ? "The two tests derive from the same role input. Selecting only one child would require a condition and its negation to hold together."
        : role === "admin"
          ? "Both tests are true under this input, so both children are present."
          : "Both tests are false under this input, so both children are absent.";
  });
}

const allDetails = getElements<HTMLDetailsElement>("details");
const expandButton = getElement<HTMLButtonElement>("#expand-details");
const syncExpandButton = (): void => {
  const isExpanded = allDetails.every((detail) => detail.open);
  expandButton.setAttribute("aria-pressed", String(isExpanded));
  expandButton.textContent = isExpanded ? "Collapse details" : "Expand details";
};
expandButton.addEventListener("click", () => {
  const shouldOpen = !allDetails.every((detail) => detail.open);
  for (const detail of allDetails) detail.open = shouldOpen;
  syncExpandButton();
});
for (const detail of allDetails) detail.addEventListener("toggle", syncExpandButton);
let printDetails: boolean[] | null = null;
window.addEventListener("beforeprint", () => {
  if (printDetails) return;
  printDetails = allDetails.map((detail) => detail.open);
  for (const detail of allDetails) detail.open = true;
});
window.addEventListener("afterprint", () => {
  if (!printDetails) return;
  allDetails.forEach((detail, index) => {
    detail.open = printDetails?.[index] ?? false;
  });
  printDetails = null;
  syncExpandButton();
});
getElement("#print-guide").addEventListener("click", () => window.print());
getElement<HTMLSelectElement>("#section-select").addEventListener("change", (event) => {
  if (event.currentTarget instanceof HTMLSelectElement)
    window.location.hash = event.currentTarget.value;
});

const sections = getElements<HTMLElement>("main > section[id]");
const navigationLinks = getElements<HTMLAnchorElement>(".sidebar nav a");
let isScrollScheduled = false;
const updateReadingPosition = (): void => {
  let currentSection = sections[0];
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= 150) currentSection = section;
  }
  for (const link of navigationLinks) {
    if (link.hash === `#${currentSection.id}`) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  }
  getElement<HTMLSelectElement>("#section-select").value = currentSection.id;
  isScrollScheduled = false;
};
const scheduleReadingUpdate = (): void => {
  if (isScrollScheduled) return;
  isScrollScheduled = true;
  requestAnimationFrame(updateReadingPosition);
};
window.addEventListener("scroll", scheduleReadingUpdate, { passive: true });
window.addEventListener("resize", scheduleReadingUpdate);
for (const detail of allDetails) detail.addEventListener("toggle", scheduleReadingUpdate);
updateReadingPosition();
document.documentElement.classList.add("js");
