import { clsx } from "clsx";
import { format } from "date-fns";
import { flow, isEmpty, map, partial } from "lodash-es";
import numeral from "numeral";

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

/** `flow` composes interpreted functions natively; the composition itself is lodash's source, called back into the interpreter. */
const shout = flow(
  (word: string) => word.toUpperCase(),
  (word: string) => `${word}!`,
);

const stamp = Date.now();

/**
 * date-fns formats a date the clock decides from its own source; `numeral`'s
 * constructor function is lifted with its prototype, so the instance it builds
 * over an unknown count finds `format`.
 */
const Summary = () => (
  <footer>
    <time>{format(new Date(stamp), "yyyy")}</time>
    <data>{numeral(words.length).format("0,0")}</data>
    <b>{shout(words.join(""))}</b>
  </footer>
);

export const isPartial = true;

export default function LiftedClosures() {
  return (
    <>
      <Words />
      <Summary />
    </>
  );
}
