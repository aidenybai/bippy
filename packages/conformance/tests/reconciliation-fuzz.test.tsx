import * as React from "react";
import {
  getFiberById,
  getFiberId,
  getLatestFiber,
  traverseRenderedFibers,
  type Fiber,
} from "bippy";
import { expect, it } from "vite-plus/test";
import { getFiberPreorder } from "./fiber-fixture.js";
import { createRenderHarness } from "./render-harness.js";
import { createSeededRandom, fuzzSeeds } from "./seeded-random.js";

interface RowProps {
  itemKey: string;
  value: number;
}

interface RowModel extends RowProps {
  group: number;
  variant: boolean;
}

interface MountedRow extends RowModel {
  firstFiber: Fiber;
  identifier: number;
  token: string;
}

interface RowRender {
  itemKey: string;
  phase: string;
}

const keys = ["", "0", "00", "__proto__", "constructor", ".$", "=:", "🧪", "a/b"];
const operations = ["insert", "update", "reverse", "move", "replace", "delete", "noop", "clear"];

it.each(fuzzSeeds)(
  "preserves committed identity and render phases through reconciliation churn, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const harness = createRenderHarness();
    let nextToken = 0;
    const renderedKeys: string[] = [];
    const Leaf = ({ itemKey, value }: RowProps) => {
      const [token] = React.useState(() => String(nextToken++));
      renderedKeys.push(itemKey);
      return (
        <span data-key={itemKey} data-token={token}>
          {value}
        </span>
      );
    };
    const Row = React.memo((props: RowProps) => <Leaf {...props} />);
    const AlternateRow = React.memo((props: RowProps) => <Leaf {...props} />);
    let rows: RowModel[] = keys.slice(0, 6).map((itemKey, index) => ({
      itemKey,
      value: 0,
      group: index % 2,
      variant: false,
    }));
    let mounted = new Map<string, MountedRow>();
    const retiredIdentifiers = new Set<number>();

    for (let step = 0; step < 160; step++) {
      const operation =
        step === 0
          ? "initial"
          : operations[step <= operations.length ? step - 1 : getRandom(operations.length)];
      const selectedIndex = getRandom(rows.length);
      const selected = rows[selectedIndex];
      switch (operation) {
        case "insert": {
          const availableKeys = keys.filter(
            (itemKey) => !rows.some((row) => row.itemKey === itemKey),
          );
          const insertionCount = 1 + getRandom(3);
          for (let insertion = 0; insertion < insertionCount && availableKeys.length; insertion++) {
            const [itemKey] = availableKeys.splice(getRandom(availableKeys.length), 1);
            rows.splice(getRandom(rows.length + 1), 0, {
              itemKey,
              value: getRandom(4),
              group: getRandom(2),
              variant: getRandom(2) === 0,
            });
          }
          break;
        }
        case "update":
          if (selected) rows[selectedIndex] = { ...selected, value: getRandom(4) };
          break;
        case "reverse":
          rows.reverse();
          break;
        case "move":
          if (selected) rows[selectedIndex] = { ...selected, group: 1 - selected.group };
          break;
        case "replace":
          if (selected) rows[selectedIndex] = { ...selected, variant: !selected.variant };
          break;
        case "delete":
          rows.splice(selectedIndex, 1);
          break;
        case "clear":
          if (getRandom(5) === 0) rows = [];
          break;
      }

      const context = JSON.stringify({ seed, step, operation, rows });
      renderedKeys.length = 0;
      await harness.render(
        <>
          {[0, 1].map((group) => (
            <section key={group}>
              {rows
                .filter((row) => row.group === group)
                .map(({ itemKey, value, variant }) => {
                  const Component = variant ? AlternateRow : Row;
                  return <Component key={itemKey} itemKey={itemKey} value={value} />;
                })}
            </section>
          ))}
        </>,
      );

      const orderedRows = [0, 1].flatMap((group) => rows.filter((row) => row.group === group));
      const fibers = getFiberPreorder(harness.getRoot().current).filter(
        (fiber) => fiber.type === Leaf,
      );
      const hosts = [...harness.container.querySelectorAll("span")];
      expect(
        fibers.map((fiber) => fiber.memoizedProps.itemKey),
        context,
      ).toEqual(orderedRows.map((row) => row.itemKey));
      expect(
        hosts.map((host) => host.getAttribute("data-key")),
        context,
      ).toEqual(orderedRows.map((row) => row.itemKey));
      expect(
        hosts.map((host) => host.textContent),
        context,
      ).toEqual(orderedRows.map((row) => String(row.value)));

      const nextMounted = new Map<string, MountedRow>();
      const expectedRenders: RowRender[] = [];
      for (let index = 0; index < orderedRows.length; index++) {
        const row = orderedRows[index];
        const fiber = fibers[index];
        const previous = mounted.get(row.itemKey);
        const isPreserved =
          previous && previous.group === row.group && previous.variant === row.variant;
        const identifier = getFiberId(fiber);
        const token = hosts[index].getAttribute("data-token");
        if (token === null) throw new Error(`Missing state token: ${context}`);
        if (isPreserved) {
          expect(identifier, context).toBe(previous.identifier);
          expect(token, context).toBe(previous.token);
          expect(getLatestFiber(previous.firstFiber) === fiber, context).toBe(true);
          if (previous.value !== row.value)
            expectedRenders.push({ itemKey: row.itemKey, phase: "update" });
        } else {
          expect(
            [...mounted.values()].some((entry) => entry.identifier === identifier),
            context,
          ).toBe(false);
          expect(retiredIdentifiers.has(identifier), context).toBe(false);
          if (previous) expect(token, context).not.toBe(previous.token);
          expectedRenders.push({ itemKey: row.itemKey, phase: "mount" });
        }
        expect(getLatestFiber(fiber) === fiber, context).toBe(true);
        if (fiber.alternate) {
          expect(getLatestFiber(fiber.alternate) === fiber, context).toBe(true);
          expect(getFiberId(fiber.alternate), context).toBe(identifier);
        }
        expect(getFiberById(identifier) === fiber, context).toBe(true);
        nextMounted.set(row.itemKey, {
          ...row,
          firstFiber: isPreserved ? previous.firstFiber : fiber,
          identifier,
          token,
        });
      }
      expect(
        new Set([...nextMounted.values()].map((entry) => entry.identifier)).size,
        context,
      ).toBe(rows.length);
      for (const previous of mounted.values()) {
        if (nextMounted.get(previous.itemKey)?.identifier !== previous.identifier)
          retiredIdentifiers.add(previous.identifier);
      }
      for (const identifier of retiredIdentifiers)
        expect(getFiberById(identifier), context).toBeNull();
      const reportedRenders: RowRender[] = [];
      traverseRenderedFibers(harness.getRoot(), (fiber, phase) => {
        if (fiber.type !== Leaf) return;
        const { itemKey } = fiber.memoizedProps;
        if (typeof itemKey !== "string") throw new Error(`Invalid row key: ${context}`);
        reportedRenders.push({ itemKey, phase });
      });
      expect(renderedKeys, context).toEqual(expectedRenders.map((entry) => entry.itemKey));
      expect(reportedRenders, context).toEqual(expectedRenders);
      mounted = nextMounted;
    }
    await harness.render(null);
    for (const { identifier } of mounted.values()) expect(getFiberById(identifier)).toBeNull();
  },
);
