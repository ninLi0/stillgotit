// Listen reads a tutor answer aloud, and the answer writes its formulas in LaTeX between $…$, $$…$$, \(…\) or \[…\].
// Read as written, a voice would say "dollar x caret 2 dollar". spokenText turns common forms into words, such as x^2
// into "x squared", \frac{a}{b} into "a over b" and \alpha into "alpha", and reads anything else as its source
// without the delimiters and braces. It finds formulas by the same rules as the page (markdown.ts), so prices such as
// "$5 and $10" are read as prices.

/**
 * The text with each formula in words, ready to be read aloud. A displayed formula ends its own sentence, so the voice
 * pauses after it, unless punctuation follows it already.
 */
export function spokenText(text: string): string {
  let out = "", at = 0;
  for (let found = nextFormula(text, at); found; found = nextFormula(text, at)) {
    const said = formulaWords(found.latex), pause = found.display && !/^\s*[,.;:!?]/.test(text.slice(found.end));
    out += plain(text.slice(at, found.start)) + (pause && said ? `${said}.` : said);
    at = found.end;
  }
  return out + plain(text.slice(at));
}

/** One formula's LaTeX source in words. */
export function formulaWords(latex: string): string {
  return words(parse(latex)).filter(Boolean).join(" ").replace(/\s+([,;.])/g, "$1").replace(/\s+/g, " ").trim();
}

// ---- Finding formulas ----

const WORD = /[A-Za-z0-9_]/, SPACE = /\s/;
/** An escaped dollar sign outside a formula is read as a dollar sign. */
const plain = (text: string) => text.replace(/\\\$/g, "$");
/** A "$" opens a formula when no letter, digit or "$" comes before it and no space or "$" after it. */
const opens = (text: string, at: number) =>
  !WORD.test(text[at - 1] ?? "") && text[at - 1] !== "$" && !!text[at + 1] && !SPACE.test(text[at + 1]!) && text[at + 1] !== "$";
/** A "$" closes a formula when no space comes before it and no letter, digit or "$" after it. */
const closes = (text: string, at: number) => !SPACE.test(text[at - 1]!) && !WORD.test(text[at + 1] ?? "") && text[at + 1] !== "$";

function nextFormula(text: string, from: number): { start: number; end: number; latex: string; display: boolean } | null {
  for (let at = from; at < text.length; at++) {
    const char = text[at];
    if (char === "\\") {
      const kind = text[at + 1];
      if (kind === "(" || kind === "[") {
        const end = text.indexOf(kind === "(" ? "\\)" : "\\]", at + 2);
        if (end > at + 2) return { start: at, end: end + 2, latex: text.slice(at + 2, end), display: kind === "[" };
      }
      at++; // An escaped character, such as \$, is not a delimiter.
      continue;
    }
    if (char !== "$") continue;
    if (text[at + 1] === "$") {
      const end = text.indexOf("$$", at + 2);
      if (end > at + 2) return { start: at, end: end + 2, latex: text.slice(at + 2, end), display: true };
      at++;
      continue;
    }
    if (!opens(text, at)) continue;
    for (let close = at + 1; close < text.length; close++) {
      if (text[close] === "\\") { close++; continue; }
      if (text[close] !== "$") continue;
      if (closes(text, close)) return { start: at, end: close + 1, latex: text.slice(at + 1, close), display: false };
      // A "$" with spaces on both sides is a lone dollar sign inside the formula's text; any other one ends the search.
      if (!(SPACE.test(text[close - 1]!) && (close + 1 >= text.length || SPACE.test(text[close + 1]!)))) break;
    }
  }
  return null;
}

// ---- Reading a formula ----

type Node = { kind: "command"; name: string } | { kind: "group"; nodes: Node[]; raw: string } | { kind: "char"; text: string };

/** LaTeX as commands, braced groups, numbers and single characters. Spaces are dropped, as in TeX's maths. */
function parse(source: string): Node[] {
  let at = 0;
  const sequence = (inGroup: boolean): Node[] => {
    const nodes: Node[] = [];
    while (at < source.length) {
      const char = source[at]!;
      if (char === "}") { at++; if (inGroup) return nodes; continue; }
      if (char === "{") { const start = ++at; const inner = sequence(true); nodes.push({ kind: "group", nodes: inner, raw: source.slice(start, at - 1) }); continue; }
      if (char === "\\") { const name = /^[A-Za-z]+/.exec(source.slice(at + 1))?.[0] ?? source[at + 1] ?? ""; at += 1 + name.length; nodes.push({ kind: "command", name }); continue; }
      if (SPACE.test(char)) { at++; continue; }
      const number = /^\d+(?:\.\d+)?/.exec(source.slice(at))?.[0] ?? char;
      at += number.length;
      nodes.push({ kind: "char", text: number });
    }
    return nodes;
  };
  return sequence(false);
}

const GREEK = new Set(["alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta", "iota", "kappa",
  "lambda", "mu", "nu", "xi", "omicron", "pi", "varpi", "rho", "varrho", "sigma", "varsigma", "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega"]);
const SAID: Record<string, string> = {
  times: "times", cdot: "times", div: "divided by", pm: "plus or minus", mp: "minus or plus",
  le: "is less than or equal to", leq: "is less than or equal to", ge: "is greater than or equal to", geq: "is greater than or equal to",
  ne: "is not equal to", neq: "is not equal to", approx: "is approximately", equiv: "is equivalent to", propto: "is proportional to",
  infty: "infinity", to: "to", rightarrow: "to", Rightarrow: "implies", implies: "implies", iff: "if and only if", mapsto: "maps to",
  in: "in", notin: "not in", subset: "subset of", subseteq: "subset of", cup: "union", cap: "intersection", emptyset: "the empty set",
  forall: "for all", exists: "there exists", neg: "not", land: "and", lor: "or", partial: "partial", nabla: "del",
  perp: "perpendicular to", parallel: "parallel to", angle: "angle", degree: "degrees", circ: "composed with", prime: "prime",
  ldots: "and so on", cdots: "and so on", dots: "and so on", vdots: "and so on", ddots: "and so on",
  sin: "sine", cos: "cosine", tan: "tangent", log: "log", ln: "natural log", exp: "exp", det: "determinant", max: "max", min: "min",
  "%": "percent", "\\": ";", "{": "", "}": "", ",": "", ";": "", ":": "", "!": "", " ": "", quad: "", qquad: "",
  left: "", right: "", big: "", Big: "", bigg: "", Bigg: "", displaystyle: "", textstyle: "", limits: "", nolimits: "",
};
const CHARS: Record<string, string> = { "=": "equals", "+": "plus", "-": "minus", "<": "is less than", ">": "is greater than", "/": "over",
  "!": "factorial", "'": "prime", "&": ",", "(": "", ")": "", "[": "", "]": "", "|": "", "~": "", ":": "" };
const BIG: Record<string, string> = { int: "the integral", iint: "the double integral", oint: "the contour integral", sum: "the sum", prod: "the product", lim: "the limit" };
/** Commands whose argument is words, read as written. */
const TEXT = new Set(["text", "textrm", "textbf", "textit", "mbox", "operatorname"]);
/** Commands that only change a letter's style, read as the letter. */
const STYLE = new Set(["mathrm", "mathbf", "mathit", "mathsf", "mathtt", "mathbb", "mathcal", "mathfrak", "boldsymbol", "bm"]);

function words(nodes: Node[]): string[] {
  const out: string[] = [];
  let at = 0;
  const next = (): Node[] => { const node = nodes[at++]; return !node ? [] : node.kind === "group" ? node.nodes : [node]; };
  const isChar = (text: string) => { const node = nodes[at]; return node?.kind === "char" && node.text === text; };
  while (at < nodes.length) {
    const node = nodes[at++]!;
    if (node.kind === "group") { out.push(...words(node.nodes)); continue; }
    if (node.kind === "char") {
      if (node.text === "^") out.push(...power(next()));
      else if (node.text === "_") out.push("sub", ...words(next()));
      else out.push(Object.hasOwn(CHARS, node.text) ? CHARS[node.text]! : node.text);
      continue;
    }
    const name = node.name;
    if (name === "frac" || name === "dfrac" || name === "tfrac") { const top = words(next()); out.push(...top, "over", ...words(next())); }
    else if (name === "sqrt") {
      const index: Node[] = [];
      if (isChar("[")) { at++; while (at < nodes.length && !isChar("]")) index.push(nodes[at++]!); at++; }
      const root = words(index).join(" ");
      out.push(!root ? "the square root of" : root === "3" ? "the cube root of" : `the ${root}th root of`, ...words(next()));
    } else if (Object.hasOwn(BIG, name)) {
      let below: Node[] | null = null, above: Node[] | null = null;
      while (isChar("_") || isChar("^")) { const mark = (nodes[at++] as { text: string }).text; if (mark === "_") below = next(); else above = next(); }
      out.push(BIG[name]!);
      if (name === "lim") { if (below) out.push("as", ...words(below).map((word) => word === "to" ? "approaches" : word)); }
      else { if (below) out.push("from", ...words(below)); if (above) out.push("to", ...words(above)); }
      out.push("of");
    } else if (name === "begin") {
      const environment = (nodes[at]?.kind === "group" ? (nodes[at++] as { raw: string }).raw : "").trim();
      if (/matrix$/.test(environment)) out.push("the matrix with rows");
    } else if (name === "end") next();
    else if (TEXT.has(name)) { const node = nodes[at++]; out.push(node?.kind === "group" ? node.raw : words(node ? [node] : []).join(" ")); }
    else if (STYLE.has(name)) out.push(...words(next()));
    else if (name === "vec") out.push("vector", ...words(next()));
    else if (name === "hat" || name === "bar" || name === "overline" || name === "tilde" || name === "dot") out.push(...words(next()), name === "overline" ? "bar" : name);
    else if (GREEK.has(name)) out.push(name.replace(/^var/, ""));
    else if (GREEK.has(name.toLowerCase())) out.push("capital", name.toLowerCase());
    else out.push(Object.hasOwn(SAID, name) ? SAID[name]! : name);
  }
  return out;
}

/** A power: "squared", "cubed", "transpose", or "to the power" and the exponent. */
function power(exponent: Node[]): string[] {
  const only = exponent.length === 1 && exponent[0]!.kind === "char" ? exponent[0]!.text : "";
  if (only === "2") return ["squared"];
  if (only === "3") return ["cubed"];
  if (only === "T") return ["transpose"];
  if (only === "'" || (exponent.length === 1 && exponent[0]!.kind === "command" && exponent[0]!.name === "prime")) return ["prime"];
  return ["to the power", ...words(exponent)];
}
