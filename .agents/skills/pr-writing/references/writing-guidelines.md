# Agent writing guidelines

Source: [Aiden Bai’s Agent Writing Guidelines](https://aidenybai.com/w). Published September 11, 2026. Copied September 24, 2026.

The rules below preserve the source text. HTML formatting is converted to Markdown.

Review text against every rule below. Flag each issue with its location and a concrete fix. Preserve the meaning. Do not invent facts to satisfy a rule.

## Rewriting & fidelity

- Preserve every requirement. Keep concrete names, examples, measurements, constraints, and terminology from the source.
- Keep required work distinct from optional suggestions. Do not turn a suggestion into a commitment.
- Do not invent requirements, edge cases, implementation details, or plans to make a rewrite feel complete.
- Keep the trigger, action, and consequence explicit. Do not reduce a conditional rule to an isolated fact.
- Preserve state boundaries. Distinguish current from cumulative values, temporary from permanent changes, and what resets from what persists.
- Resolve ambiguity only when the source makes the intended meaning evident. Do not guess at missing rules.
- Keep named methods when replacing them would weaken a requirement. Leave passages designated as verbatim unchanged.
- Never remove, merge, or rename distinct requirements to meet a word target.

## Voice & tone

- Prefer active voice. “Queries are validated” becomes “the compiler validates queries”. Passive is fine when the actor is unknown or irrelevant.
- Address the reader as `you`, never `the user` or `one can`.
- Use the imperative for steps. Write “Click **Add Project**”, not “You will need to click **Add Project**”.
- Aim for sentences under 20 words. Keep related clauses together when splitting would obscure the meaning.
- Use contractions such as “you’ll” and “it’s” for warmth.
- Use present tense unless describing past events or future behavior.
- Limit “we” to deliberate actions by your organization, never as a stand-in for “you”.
- Cut rhetorical questions, flattery, and chatbot pleasantries such as “Great question!”, “Of course!”, and “I hope this helps!”
- Read once at speech pace. If you need another pass, name the subject, action, and consequence.

## Word choice

- Prefer plain words. “Utilize” becomes “use”, “facilitate” becomes “help”, and “in the event that” becomes “if”.
- Use literal phrasing. “A dial worth turning” becomes “a parameter worth varying”. Cut metaphor or flourish that adds no meaning.
- Name the mechanism or measurable result. “The database stays close at hand” says nothing about its behavior.
- Make specific claims. “Types that follow your schema” becomes “a column rename fails the build”, if that is what happens.
- Replace “lands”, “carries”, “hits”, or “rides along” with the actual step, such as “returns”, “stores”, or “calls”.
- Pick one name for each thing. Do not cycle through synonyms for variety.
- Replace specialist terms only when familiar words preserve the meaning.
- Keep adjectives that specify an observable result. “Raised edge” gives direction, while “stylish finish” does not.
- Cut adverbs or state the result. “Significantly improves” needs a measured change, not a stronger adjective.
- Prefer direct statements. “Serves as” becomes “is”, and “boasts” becomes “has”. Replace “Not just X, but Y” with the point itself.

## Banned words

- Do not describe reader actions as `easy`, `simple`, or `quick`. Use a concrete description, such as “one command” or “default settings”.
- Cut or rewrite filler words such as `very`, `just`, `really`, and `simply`.
- Cut or replace inflated vocabulary such as “crucial”, “delve”, “enduring”, “enhance”, “garner”, “interplay”, “intricate”, “pivotal”, “testament”, “underscore”, and “vibrant”.
- Replace abstract metaphor nouns such as “substrate”, “wedge”, “vector”, “locus”, “vantage”, “nexus”, “bedrock”, “modality”, and “paradigm” with the concrete thing or action.
- Keep literal technical meanings of “primitive”, “harness”, “surface”, “scaffolding”, and “ratchet”. Replace figurative uses.
- Replace stock metaphors such as “landscape”, “tapestry”, “north star”, and “flywheel” with the subject, goal, or process.
- Replace inflated descriptions. “Gold-plating” becomes “more than the job needs”, “evacuate” becomes “move out”, and “endgame” becomes “the last phase”.

## Concision

- Use ASD-STE100 Simplified Technical English for technical prose.
- Cut repetition and incidental detail that do not change understanding or action. Keep explicit source requirements when rewriting.
- Keep one idea per sentence. Split dense sentences or drop clauses that make the reader backtrack.
- Cut filler phrases. “In order to” becomes “to”, and “due to the fact that” becomes “because”. Delete “it is important to note that”.
- Replace excessive hedging such as “could potentially possibly” with “may”. Keep uncertainty when the evidence requires it.
- Keep articles and verbs. “Parser rejects bad date → exit 2, no write” becomes “The parser rejects a bad date, exits with code 2, and writes nothing”.
- Cut generic conclusions such as “The future looks bright”. End with a specific fact, decision, or next step.

## Claims & evidence

- Replace vague qualifiers such as “significantly”, “many”, “often”, “typically”, or “generally” with a specific claim you can support.
- Replace “near-zero”, “sub-second”, or “most requests” with a cited figure. If no figure exists, narrow or remove the claim.
- Name the source behind “experts believe” or “industry reports suggest”. Cite it or cut the attribution.
- Check phrases such as “highlighting…”, “ensuring…”, “reflecting…”, “showcasing…”, and “fostering…” for unsupported implications. State the consequence and its evidence, or delete the phrase.
- If a sentence could describe another project unchanged, name what distinguishes this one or cut it.

## AI-generated tells (flag these)

- Cut summary-style transitions such as “With this setup complete…” or “Now that we’ve explored…”. Start with the next point.
- Do not split one dependent idea into fragments. “Previously this was manual. Now it’s automatic” becomes “The scheduler now runs the task automatically”.
- Replace spec-sheet phrasing such as “is configurable” with what you can configure and how.
- Connect a paragraph’s opening sentence to the preceding idea when it continues that idea. Do not force a transition for a new subject.
- Avoid personified artifacts. “Hand the browser a URL” becomes “the browser fetches the URL”.
- Cut template framing such as “The question most teams face is whether…”. State the choice specific to the subject.
- Use the number of items the subject requires. Do not force groups of three.
- Use “from X to Y” only for a meaningful range. Otherwise, list the topics.
- Cut “additionally” when the next sentence already makes the connection clear.

## Tone, by content type

- Keep tutorials warm, encouraging, and predictable. Do not hide prerequisites or failure conditions.
- Keep how-to instructions terse and direct because the reader is mid-task.
- Keep reference writing neutral, exhaustive, and quotable.
- Explain concepts so the reader can teach them back. Use examples or analogies that clarify a mechanism.
- When troubleshooting, acknowledge the problem, then explain the fix. Be empathetic, not apologetic.
- In feedback, state what is wrong, when it happens, and the expected result. Use natural paragraphs, not report language. Clear fragments or shorthand are fine.

## Headings & structure

- Match the requested format. Do not add headings, lists, summaries, or commentary to a plain-paragraph rewrite.
- Let each thought start naturally. Do not impose a recurring opener or fixed structure.
- Use sentence case for headings. Write “Configure environment variables”, not “Configure Environment Variables”.
- Use descriptive headings such as “Caveats when self-hosting”, not “Caveats”. The heading should predict the section’s content.
- Open explanatory prose with a short summary. Start each major section with its main point.
- Define unfamiliar terms on first use. Spell out acronyms, such as “Content Security Policy”, before using “CSP”.
- Keep paragraphs to 2 to 4 sentences. Split anything longer or covering two ideas. Shorter paragraphs are fine for emphasis.

## Lists

- Convert 3 or more list-shaped items in prose to a list.
- Use bullets for unordered items and numbers for sequential steps or ranked items.
- End prose that introduces a list with a colon.
- Use periods for complete sentences, not fragments.
- Avoid labels that repeat the description. State the information directly.
- For definitions, use `- **Term**: description`. Keep labels short. Do not turn every bullet into a heading.

## Emphasis

- Use bold for user interface elements or critical facts, not for tone. Rewrite a sentence that needs bold to sound convincing.
- Do not bold every proper noun or acronym.
- Use inline code for paths, extensions, identifiers, and snippets such as `/api`, `.tsx`, `body`, and `query`.
- Remove decorative emojis from headings and bullets.

## Punctuation & typography

- Do not use em dashes or en dashes as punctuation. Split the sentence or use a comma. Do not substitute a hyphen or parenthetical aside.
- Prefer periods or commas over mid-sentence colons or semicolons. Reserve colons for lists or examples.
- Use curly quotes in prose, such as “text” and ‘text’. Keep straight quotes in code and literal syntax.
- Use the ellipsis `…`, not three dots `...`.
- Use “and” in prose. Reserve `&` for compact labels.
- Use non-breaking spaces between values and units, such as `10&nbsp;MB`.

## Data sizes & units

- Separate values from units, as in `64 KB`, `5 KB`, `200 ms`, and `30 s`.
- Preserve unit case. Use `KB` for kilobytes and `ms` for milliseconds. Do not uppercase every unit.
- Keep units consistent. Preserve exact syntax in code or quoted output.

## Source formatting & links

- Keep each paragraph on one source line and let the editor wrap the text.
- Use one blank line before headings and around code blocks. Do not add extra blank lines between list items.
- Do not use `---` horizontal rules between sections.
- Name the destination in link text. Do not use bare URLs or “here” and “link” as anchor text.

## Output format

For reviews without a requested format, group findings by file. Use `file:line - issue. Suggested fix` for each finding. If the input has no file or line numbers, identify the section and quote the affected phrase.

Report each distinct issue once. Skip explanations unless the fix is non-obvious. If you find no issues, return “Pass”.

For rewrites, return only the rewritten text unless you were asked for an explanation. Do not append rationale, progress summaries, or plans.
