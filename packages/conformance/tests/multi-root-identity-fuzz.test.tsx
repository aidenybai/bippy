import * as React from "react";
import { createPortal } from "react-dom";
import { getFiber, getFiberById, getFiberId, getLatestFiber, getRenderer, type Fiber } from "bippy";
import { expect, it } from "vite-plus/test";
import { getFiberPreorder } from "./fiber-fixture.js";
import { createRenderHarness } from "./render-harness.js";
import { createSeededRandom, fuzzSeeds } from "./seeded-random.js";

interface PortalRowProps {
  owner: number;
  itemKey: string;
  value: number;
}

interface RootModel {
  target: number;
  value: number;
  keys: string[];
}

interface IdentityRecord {
  identifier: number;
  firstFiber: Fiber;
  target: number;
}

it("keeps each render harness attached to its own root", async () => {
  const first = createRenderHarness();
  const second = createRenderHarness();
  await first.render(<span>first</span>);
  const firstRoot = first.getRoot();
  await second.render(<span>second</span>);
  expect(first.getRoot() === firstRoot).toBe(true);
  expect(second.getRoot() === firstRoot).toBe(false);
  const secondRoot = second.getRoot();
  await first.render(null);
  expect(second.getRoot() === secondRoot).toBe(true);
});

it.each(fuzzSeeds)(
  "isolates IDs across roots sharing portal containers and duplicate keys, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const harnesses = Array.from({ length: 3 }, () => createRenderHarness());
    const targets = [document.createElement("aside"), document.createElement("aside")];
    const rowKeys = ["", "__proto__", "0", ".$", "🧪"];
    const models: RootModel[] = harnesses.map(() => ({ target: 0, value: 0, keys: [...rowKeys] }));
    const identities = harnesses.map(() => new Map<string, IdentityRecord>());
    const retired = new Set<number>();
    const exercised = { portalRemount: 0, retained: 0, deletion: 0, emptyKey: 0 };
    const Leaf = ({ owner, itemKey, value }: PortalRowProps) => (
      <span data-owner={owner} data-key={itemKey}>
        {value}
      </span>
    );
    const Row = React.memo(Leaf);
    const renderOwner = async (owner: number) => {
      const model = models[owner];
      await harnesses[owner].render(
        createPortal(
          <>
            {model.keys.map((itemKey) => (
              <Row key={itemKey} itemKey={itemKey} owner={owner} value={model.value} />
            ))}
          </>,
          targets[model.target],
          "shared-portal-key",
        ),
      );
    };
    for (let owner = 0; owner < harnesses.length; owner++) await renderOwner(owner);
    const roots = harnesses.map((harness) => harness.getRoot());
    expect(new Set(roots).size).toBe(harnesses.length);

    for (let step = 0; step < 120; step++) {
      const owner = getRandom(harnesses.length);
      const model = models[owner];
      const operation = getRandom(6);
      if (step > 0) {
        if (operation === 0) model.target = 1 - model.target;
        if (operation === 1) model.value++;
        if (operation === 2) model.keys.reverse();
        if (operation === 3) model.keys = [];
        if (operation === 4) model.keys = rowKeys.filter(() => getRandom(2) === 0);
        await renderOwner(owner);
      }
      const context = JSON.stringify({ seed, step, owner, operation, models });
      const liveIdentifiers = new Set<number>();
      for (let checkedOwner = 0; checkedOwner < harnesses.length; checkedOwner++) {
        const harness = harnesses[checkedOwner];
        const currentModel = models[checkedOwner];
        expect(harness.getRoot() === roots[checkedOwner], context).toBe(true);
        const fibers = getFiberPreorder(harness.getRoot().current).filter(
          (fiber) => fiber.type === Leaf,
        );
        expect(
          fibers.map((fiber) => fiber.key),
          context,
        ).toEqual(currentModel.keys);
        for (const [targetIndex, target] of targets.entries()) {
          const ownedHosts = [
            ...target.querySelectorAll<HTMLElement>(`[data-owner="${checkedOwner}"]`),
          ];
          expect(
            ownedHosts.map((host) => host.dataset.key),
            context,
          ).toEqual(targetIndex === currentModel.target ? currentModel.keys : []);
        }
        const nextIdentities = new Map<string, IdentityRecord>();
        for (const fiber of fibers) {
          const itemKey = fiber.key;
          if (itemKey === null) throw new Error(`Missing row key: ${context}`);
          const previous = identities[checkedOwner].get(itemKey);
          const identifier = getFiberId(fiber);
          if (itemKey === "") exercised.emptyKey++;
          if (previous?.target === currentModel.target) {
            exercised.retained++;
            expect(identifier, context).toBe(previous.identifier);
            expect(getLatestFiber(previous.firstFiber) === fiber, context).toBe(true);
          } else if (previous) {
            exercised.portalRemount++;
            expect(identifier, context).not.toBe(previous.identifier);
            retired.add(previous.identifier);
          }
          expect(liveIdentifiers.has(identifier), context).toBe(false);
          expect(retired.has(identifier), context).toBe(false);
          liveIdentifiers.add(identifier);
          expect(getLatestFiber(fiber) === fiber, context).toBe(true);
          expect(getFiberById(identifier) === fiber, context).toBe(true);
          const host = fiber.child;
          if (!host || !(host.stateNode instanceof HTMLElement))
            throw new Error(`Missing host: ${context}`);
          expect(host.stateNode.parentNode === targets[currentModel.target], context).toBe(true);
          expect(host.stateNode.dataset.owner, context).toBe(String(checkedOwner));
          expect(host.stateNode.textContent, context).toBe(String(currentModel.value));
          const capturedHost = getFiber(host.stateNode);
          if (!capturedHost) throw new Error(`Host lookup failed: ${context}`);
          expect(getLatestFiber(capturedHost) === host, context).toBe(true);
          expect(getRenderer(capturedHost) === getRenderer(fiber), context).toBe(true);
          expect(getRenderer(fiber)?.rendererPackageName, context).toBe("react-dom");
          nextIdentities.set(itemKey, {
            identifier,
            firstFiber: previous?.target === currentModel.target ? previous.firstFiber : fiber,
            target: currentModel.target,
          });
        }
        for (const [itemKey, previous] of identities[checkedOwner]) {
          if (!nextIdentities.has(itemKey)) {
            exercised.deletion++;
            retired.add(previous.identifier);
          }
        }
        identities[checkedOwner] = nextIdentities;
      }
      for (const identifier of retired) expect(getFiberById(identifier), context).toBeNull();
      expect(
        targets.reduce((count, target) => count + target.childElementCount, 0),
        context,
      ).toBe(models.reduce((count, currentModel) => count + currentModel.keys.length, 0));
    }
    for (const [operation, count] of Object.entries(exercised)) {
      expect(count, `seed ${seed}, exercised ${operation}`).toBeGreaterThan(0);
    }
    for (const [owner, harness] of harnesses.entries()) {
      await harness.render(null);
      for (const [checkedOwner, records] of identities.entries()) {
        for (const { identifier, firstFiber } of records.values()) {
          if (checkedOwner <= owner) expect(getFiberById(identifier)).toBeNull();
          else expect(getFiberById(identifier)).toBe(getLatestFiber(firstFiber));
        }
      }
      for (const target of targets) {
        expect(target.querySelectorAll(`[data-owner="${owner}"]`).length).toBe(0);
      }
    }
    expect(targets.map((target) => target.childElementCount)).toEqual([0, 0]);
  },
);
