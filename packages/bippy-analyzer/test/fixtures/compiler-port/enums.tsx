// @ts-nocheck
enum Size {
  Small = "small",
  Large = "large",
}

export const EnumComponent = ({ isLarge }: { isLarge: boolean }) => {
  enum Tone {
    Quiet = "quiet",
    Loud = "loud",
  }
  const tone = isLarge ? Tone.Loud : Tone.Quiet;
  return <div className={isLarge ? Size.Large : Size.Small}>{tone}</div>;
};
