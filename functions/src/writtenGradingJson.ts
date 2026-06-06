const LATEX_COMMANDS = [
  "frac",
  "sqrt",
  "pi",
  "times",
  "div",
  "cdot",
  "left",
  "right",
  "le",
  "ge",
  "neq",
  "theta",
  "alpha",
  "beta",
  "gamma",
  "Delta",
].join("|");

const latexCommandPattern = new RegExp(`(?<!\\\\)\\\\(?=(?:${LATEX_COMMANDS})\\b)`, "g");

function escapeLikelyLatexBackslashes(raw: string): string {
  return raw
    .replace(latexCommandPattern, "\\\\")
    .replace(/(?<!\\)\\(?=[()])/g, "\\\\");
}

function parsePossiblyUnescapedLatexJson(raw: string): any {
  const escapedLatex = escapeLikelyLatexBackslashes(raw);
  try {
    return JSON.parse(escapedLatex);
  } catch {
    const repaired = escapedLatex.replace(/(?<!\\)\\(?!["\\/bfnrtu])/g, "\\\\");
    return JSON.parse(repaired);
  }
}

export function extractJsonObject(text: string): any {
  try {
    return parsePossiblyUnescapedLatexJson(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON object in Gemini response.");
    return parsePossiblyUnescapedLatexJson(match[0]);
  }
}
