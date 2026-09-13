import { useEffect, useState } from "react";
import { EventEmitter } from "./shared/node-events";

const transcripts = new EventEmitter();

/** react-speech-recognition's `concatTranscripts`: trims and joins every part. */
const concatTranscripts = (...parts: string[]) =>
  parts
    .map((part) => part.trim())
    .join(" ")
    .trim();

/** Both halves are set by an external subscriber, so each is `"" | unknown`; their join must stay a branch, not collapse to an unknown string. */
export default function JoinedBranches() {
  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  useEffect(() => {
    transcripts.on("final", setFinalTranscript);
    transcripts.on("interim", setInterimTranscript);
    return () => {
      transcripts.off("final", setFinalTranscript);
      transcripts.off("interim", setInterimTranscript);
    };
  }, []);
  const transcript = concatTranscripts(finalTranscript, interimTranscript);
  const tags = [finalTranscript, null, undefined, 1].join("-");
  return (
    <section>
      <p>{transcript}</p>
      {transcript ? <button type="button">speak</button> : <em>idle</em>}
      <code>
        {tags}
        <i />
      </code>
    </section>
  );
}
