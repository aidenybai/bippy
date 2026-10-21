import { useEffect, useRef } from "react";

interface Dataset {
  hidden: boolean;
}

export const RefAliasMutation = ({ datasets }: { datasets: Dataset[] }) => {
  const chart = useRef<{ data: { datasets: Dataset[] } } | null>(null);
  useEffect(() => {
    chart.current = { data: { datasets: [] } };
  }, []);
  useEffect(() => {
    if (chart.current) {
      chart.current.data.datasets = datasets;
      chart.current.data.datasets.forEach((dataset) => {
        dataset.hidden = true;
      });
    }
  }, [datasets]);
  return <p>{datasets.length}</p>;
};

interface Doc {
  data: { url: string };
}

class Rewriter {
  static strip(doc: Doc): void {
    Rewriter.rewrite(doc.data);
  }

  static rewrite(data: { url: string }): void {
    data.url = "";
  }
}

export const ClassMethodMutation = ({ document }: { document: Doc }) => {
  Rewriter.strip(document);
  return <p>{document.data.url}</p>;
};
