type ParseSuccess = { readonly ok: true; readonly word: string; readonly sentence: string };
type ParseError = { readonly ok: false; readonly error: string };
export type ParseResult = ParseSuccess | ParseError;

export function parseAddCommand(input: string): ParseResult {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { ok: false, error: "Input is empty. Usage: /add word | sentence" };
  }

  let word: string;
  let sentence: string;

  const pipeIndex = trimmed.indexOf("|");
  const newlineIndex = trimmed.indexOf("\n");

  if (pipeIndex !== -1) {
    word = trimmed.slice(0, pipeIndex).trim();
    sentence = trimmed.slice(pipeIndex + 1).trim();
  } else if (newlineIndex !== -1) {
    word = trimmed.slice(0, newlineIndex).trim();
    sentence = trimmed.slice(newlineIndex + 1).trim();
  } else {
    return { ok: false, error: "Missing separator. Usage: /add word | sentence" };
  }

  if (word === "") {
    return { ok: false, error: "Word is empty. Usage: /add word | sentence" };
  }
  if (sentence === "") {
    return { ok: false, error: "Sentence is empty. Usage: /add word | sentence" };
  }

  return { ok: true, word, sentence };
}
