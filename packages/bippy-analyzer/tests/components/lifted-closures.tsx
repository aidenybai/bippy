import { clsx } from "clsx";
import { isEmpty, map, partial } from "lodash-es";

/** The wall clock decides the words: a list of strings whose count the static side does not know. */
const words = new Date().toISOString().split("-");

/** lodash's `partial` builds a native wrapper around an interpreted function; calling it has to come back into the interpreter. */
const label = partial((prefix: string, word: string) => `${prefix}:${word}`, "word");

const Word = ({ word }: { word: string }) => (
  <li className={clsx("word", { long: word.length > 5 })}>{label(word)}</li>
);

/**
 * `isEmpty` and `map` are lodash's own installed code, evaluated from its
 * source over the variables it captured: the decision is over the list, and
 * the callback is the interpreter's, so the items are `Word` fibers rather
 * than a wildcard.
 */
const Words = () => (
  <section className={clsx("words", { many: words.length > 2 })}>
    {isEmpty(words) ? (
      <em>none</em>
    ) : (
      <ul>
        {map(words, (word, index) => (
          <Word key={index} word={word} />
        ))}
      </ul>
    )}
  </section>
);

export const isPartial = true;

export default function LiftedClosures() {
  return <Words />;
}
