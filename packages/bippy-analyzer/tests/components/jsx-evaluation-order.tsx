import type { ReactNode } from "react";

interface ViewProps {
  title?: string;
  children?: ReactNode;
}

const View = (_props: ViewProps): never => {
  throw new Error("An unused element must not render its component");
};

const isBroken = Boolean(document.createElement("canvas").getContext("2d"));

const getTrace = (failureStage: string): string => {
  const trace: string[] = [];
  const record = (stage: string): string => {
    trace.push(stage);
    if (isBroken && stage === failureStage) throw "stop";
    return stage;
  };
  const owner = {
    get View() {
      record("type");
      return View;
    },
  };
  const source = {
    get title() {
      return record("spread");
    },
  };
  try {
    void (
      <owner.View {...source} title={record("prop")}>
        {record("child")}
        {record("tail")}
      </owner.View>
    );
    trace.push("done");
  } catch {
    trace.push("caught");
  }
  return trace.join(",");
};

export const isPartial = true;
export const isEnumerated = true;

export default () => (
  <main>
    {["type", "spread", "prop", "child", "tail", "none"].map((stage) => (
      <p key={stage}>
        {"trace:"}
        {getTrace(stage)}
      </p>
    ))}
  </main>
);
