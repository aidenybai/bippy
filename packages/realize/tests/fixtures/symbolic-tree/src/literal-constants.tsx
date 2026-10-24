const SIZES = { small: "sm", large: "lg" } as const;

type Size = (typeof SIZES)[keyof typeof SIZES];

enum Tone {
  Calm = "calm",
  Loud = "loud",
}

const DEFAULT_TONE = Tone.Calm;

export const SizeLabel = ({ size }: { size: Size }) => {
  switch (size) {
    case SIZES.small:
      return <p>Small</p>;
    case SIZES.large:
      return <p>Large</p>;
  }
};

export const ToneLabel = ({ tone = DEFAULT_TONE }: { tone?: Tone }) =>
  tone === Tone.Loud ? <strong>Loud</strong> : <span>Calm</span>;
