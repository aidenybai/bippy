interface Point {
  key: string;
  offset: number;
}

class Selection {
  anchor: Point;
  focus: Point;
  constructor(anchor: Point, focus: Point) {
    this.anchor = anchor;
    this.focus = focus;
  }
  clone(): Selection {
    return new Selection({ ...this.anchor }, { ...this.focus });
  }
  isCollapsed(): boolean {
    return this.anchor.key === this.focus.key && this.anchor.offset === this.focus.offset;
  }
  settle(anchorElement: HTMLElement): Selection {
    const next = this.clone();
    return anchorElement.offsetHeight === 0 ? next : next.settle(anchorElement);
  }
  settleWhileLaidOut(anchorElement: HTMLElement): Selection {
    const next = this.clone();
    if (anchorElement.offsetHeight > 0) return next.settleWhileLaidOut(anchorElement);
    return next;
  }
}

const paragraph = document.createElement("p");
const initial = new Selection({ key: "p1", offset: 0 }, { key: "p1", offset: 0 });

export const isPartial = true;

export default function RecursionFreshReceiver() {
  const settled = initial.settle(paragraph);
  const laidOut = initial.settleWhileLaidOut(paragraph);
  return (
    <section>
      {settled.isCollapsed() ? <output>collapsed</output> : <mark>range</mark>}
      {laidOut.isCollapsed() ? <output>collapsed</output> : <mark>range</mark>}
    </section>
  );
}
