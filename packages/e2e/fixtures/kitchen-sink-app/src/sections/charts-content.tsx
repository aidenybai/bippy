import { Chart as ChartJs, registerables } from "chart.js";
import useEmblaCarousel from "embla-carousel-react";
import { useEffect, useState } from "react";
import { Line as ChartJsLine } from "react-chartjs-2";
import { DayPicker } from "react-day-picker";
import ReactMarkdown from "react-markdown";
import { Line, LineChart, XAxis, YAxis } from "recharts";

import type { LibrarySection } from "../section-registry";

ChartJs.register(...registerables);

const rechartsData = [
  { step: 1, renders: 4 },
  { step: 2, renders: 7 },
  { step: 3, renders: 5 },
];

const RechartsSection = () => (
  <LineChart width={220} height={120} data={rechartsData}>
    <XAxis dataKey="step" />
    <YAxis />
    <Line type="monotone" dataKey="renders" isAnimationActive={false} />
  </LineChart>
);

const chartJsData = {
  labels: ["a", "b", "c"],
  datasets: [{ label: "renders", data: [3, 6, 4] }],
};

const ChartJsSection = () => (
  <div style={{ width: 220, height: 120 }}>
    <ChartJsLine data={chartJsData} options={{ animation: false, responsive: false }} />
  </div>
);

const ReactMarkdownSection = () => (
  <div data-testid="markdown-host">
    <ReactMarkdown>{"# markdown heading\n\nrendered *by* react-markdown"}</ReactMarkdown>
  </div>
);

const DayPickerSection = () => {
  const [selectedDay, setSelectedDay] = useState<Date | undefined>();
  return (
    <div>
      <DayPicker
        mode="single"
        defaultMonth={new Date(2026, 7)}
        selected={selectedDay}
        onSelect={setSelectedDay}
      />
      <output data-testid="day-picker-selected">
        {selectedDay ? selectedDay.getDate() : "none"}
      </output>
    </div>
  );
};

const EmblaSection = () => {
  const [emblaRef, emblaApi] = useEmblaCarousel();
  const [selectedSlideIndex, setSelectedSlideIndex] = useState(0);
  useEffect(() => {
    if (!emblaApi) return;
    const handleSelect = () => setSelectedSlideIndex(emblaApi.selectedScrollSnap());
    emblaApi.on("select", handleSelect);
    return () => {
      emblaApi.off("select", handleSelect);
    };
  }, [emblaApi]);
  return (
    <div>
      <div ref={emblaRef} style={{ overflow: "hidden", width: 200 }}>
        <div style={{ display: "flex" }}>
          <div style={{ flex: "0 0 100%" }}>slide one</div>
          <div style={{ flex: "0 0 100%" }}>slide two</div>
        </div>
      </div>
      <button data-testid="interact-embla" onClick={() => emblaApi?.scrollNext()}>
        next slide
      </button>
      <output data-testid="embla-selected">{selectedSlideIndex}</output>
    </div>
  );
};

export const chartContentSections: LibrarySection[] = [
  { name: "recharts", Component: RechartsSection },
  { name: "chartjs", Component: ChartJsSection },
  { name: "react-markdown", Component: ReactMarkdownSection },
  { name: "react-day-picker", Component: DayPickerSection },
  { name: "embla-carousel", Component: EmblaSection },
];
