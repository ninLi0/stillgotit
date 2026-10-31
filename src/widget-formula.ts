// The formula language of a slider example (src/answer-widgets.ts). The tutor writes a formula in one or two variables,
// such as `0.5 * m * v^2`, and the learner moves a slider for each variable. The host checks the formula before an answer
// is saved, and the lesson page works out its value each time a slider moves. Both use this module, which reads a formula
// into a small tree and works the tree out by walking it. It never runs text as code: there is no eval and no Function.
//
// A formula holds numbers (12, 3.5, .5, 1e3), the declared variables, the constants pi and e, the operators + - * / and ^
// with parentheses, and calls to the functions listed below. ^ binds tighter than a leading minus, so -x^2 is -(x^2), and it
// groups from the right, so 2^3^2 is 2^9. Multiplication is always written: 2m is refused. ×, ·, ÷ and the minus sign −
// are read as *, *, / and -, and ** as ^.

/** The longest formula, in characters, and the most tokens and nesting one formula may hold. */
export const FORMULA_LIMITS = Object.freeze({ characters: 200, tokens: 120, depth: 24 });

type Fn = (...args: number[]) => number;
/** The functions a formula may call, with how many arguments each takes. log is base 10 and ln is the natural logarithm. */
export const FORMULA_FUNCTIONS: Readonly<Record<string, { arity: number; apply: Fn }>> = Object.freeze({
  sqrt: { arity: 1, apply: Math.sqrt }, abs: { arity: 1, apply: Math.abs }, exp: { arity: 1, apply: Math.exp },
  ln: { arity: 1, apply: Math.log }, log: { arity: 1, apply: Math.log10 },
  sin: { arity: 1, apply: Math.sin }, cos: { arity: 1, apply: Math.cos }, tan: { arity: 1, apply: Math.tan },
  asin: { arity: 1, apply: Math.asin }, acos: { arity: 1, apply: Math.acos }, atan: { arity: 1, apply: Math.atan },
  floor: { arity: 1, apply: Math.floor }, ceil: { arity: 1, apply: Math.ceil }, round: { arity: 1, apply: Math.round },
  min: { arity: 2, apply: Math.min }, max: { arity: 2, apply: Math.max },
});
/** The named constants a formula may use. */
export const FORMULA_CONSTANTS: Readonly<Record<string, number>> = Object.freeze({ pi: Math.PI, e: Math.E });

export type Operator = "+" | "-" | "*" | "/" | "^";
/** A formula read into a tree. A name is a variable or a constant; a call names one of FORMULA_FUNCTIONS. */
export type FormulaNode =
  | { type: "number"; value: number }
  | { type: "name"; name: string }
  | { type: "negate"; argument: FormulaNode }
  | { type: "binary"; operator: Operator; left: FormulaNode; right: FormulaNode }
  | { type: "call"; name: string; args: FormulaNode[] };

/** A formula that was read, with the variable names it uses in order of first use, or the reason it could not be read. */
export type ParsedFormula = { ok: true; tree: FormulaNode; variables: string[] } | { ok: false; reason: string };

type Token = { kind: "number"; value: number } | { kind: "name"; name: string } | { kind: "symbol"; symbol: string };

const ALIASES: Readonly<Record<string, string>> = { "×": "*", "·": "*", "÷": "/", "−": "-" };
const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/, NAME = /^[A-Za-z_][A-Za-z0-9_]*/;

function tokenize(text: string): Token[] | string {
  const tokens: Token[] = [];
  let at = 0;
  while (at < text.length) {
    const rest = text.slice(at), char = rest[0]!;
    if (/\s/.test(char)) { at++; continue; }
    const number = NUMBER.exec(rest);
    if (number) {
      const value = Number(number[0]);
      if (!Number.isFinite(value)) return "a number is too large";
      tokens.push({ kind: "number", value }); at += number[0].length; continue;
    }
    const name = NAME.exec(rest);
    if (name) { tokens.push({ kind: "name", name: name[0] }); at += name[0].length; continue; }
    if (rest.startsWith("**")) { tokens.push({ kind: "symbol", symbol: "^" }); at += 2; continue; }
    const symbol = ALIASES[char] ?? char;
    if (!"+-*/^(),".includes(symbol)) return `the character ${JSON.stringify(char)} is not part of a formula`;
    tokens.push({ kind: "symbol", symbol }); at++;
  }
  return tokens;
}

/** Reads a formula. It refuses anything outside the language above, a formula that is too long, and an unknown function. */
export function parseFormula(text: string): ParsedFormula {
  if (typeof text !== "string" || !text.trim()) return { ok: false, reason: "the formula is empty" };
  if (text.length > FORMULA_LIMITS.characters) return { ok: false, reason: "the formula is too long" };
  const tokens = tokenize(text);
  if (typeof tokens === "string") return { ok: false, reason: tokens };
  if (tokens.length > FORMULA_LIMITS.tokens) return { ok: false, reason: "the formula is too long" };
  let at = 0, depth = 0;
  const variables: string[] = [];
  const peek = (): Token | undefined => tokens[at];
  const isSymbol = (symbol: string) => { const token = peek(); return token?.kind === "symbol" && token.symbol === symbol; };
  class Refused extends Error {}
  const refuse = (reason: string): never => { throw new Refused(reason); };
  const nested = <T>(read: () => T): T => {
    if (++depth > FORMULA_LIMITS.depth) refuse("the formula is nested too deeply");
    try { return read(); } finally { depth--; }
  };
  const expression = (): FormulaNode => nested(() => {
    let node = term();
    while (isSymbol("+") || isSymbol("-")) {
      const operator = (tokens[at++] as { symbol: Operator }).symbol;
      node = { type: "binary", operator, left: node, right: term() };
    }
    return node;
  });
  const term = (): FormulaNode => {
    let node = unary();
    while (isSymbol("*") || isSymbol("/")) {
      const operator = (tokens[at++] as { symbol: Operator }).symbol;
      node = { type: "binary", operator, left: node, right: unary() };
    }
    return node;
  };
  const unary = (): FormulaNode => nested(() => {
    if (isSymbol("-")) { at++; return { type: "negate", argument: unary() }; }
    if (isSymbol("+")) { at++; return unary(); }
    return power();
  });
  const power = (): FormulaNode => {
    const base = primary();
    if (!isSymbol("^")) return base;
    at++;
    return { type: "binary", operator: "^", left: base, right: unary() };
  };
  const primary = (): FormulaNode => {
    const token = peek();
    if (!token) return refuse("the formula ends too soon");
    at++;
    if (token.kind === "number") return { type: "number", value: token.value };
    if (token.kind === "symbol") {
      if (token.symbol !== "(") return refuse(`the formula has ${JSON.stringify(token.symbol)} where a value belongs`);
      const inner = expression();
      if (!isSymbol(")")) refuse("a parenthesis is not closed");
      at++;
      return inner;
    }
    if (isSymbol("(")) {
      const fn = FORMULA_FUNCTIONS[token.name];
      if (!fn || !Object.hasOwn(FORMULA_FUNCTIONS, token.name)) return refuse(`${token.name} is not one of the formula's functions`);
      at++;
      const args: FormulaNode[] = [expression()];
      while (isSymbol(",")) { at++; args.push(expression()); }
      if (!isSymbol(")")) refuse("a parenthesis is not closed");
      at++;
      if (args.length !== fn.arity) refuse(`${token.name} takes ${fn.arity === 1 ? "one value" : `${fn.arity} values`}`);
      return { type: "call", name: token.name, args };
    }
    if (Object.hasOwn(FORMULA_FUNCTIONS, token.name)) return refuse(`${token.name} needs its value in parentheses`);
    if (!Object.hasOwn(FORMULA_CONSTANTS, token.name) && !variables.includes(token.name)) variables.push(token.name);
    return { type: "name", name: token.name };
  };
  try {
    const tree = expression();
    if (at < tokens.length) return { ok: false, reason: "the formula has more after its end; write every multiplication with *" };
    return { ok: true, tree, variables };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, reason: error.message };
    throw error;
  }
}

/**
 * The formula's value for the given variables. A value that is not a real number, such as a square root of a negative
 * number or a division by zero, comes back as NaN or an infinity, and the caller says the formula is not defined there.
 * A name with no value is NaN as well.
 */
export function evaluateFormula(tree: FormulaNode, values: Readonly<Record<string, number>>): number {
  switch (tree.type) {
    case "number": return tree.value;
    case "name": return Object.hasOwn(FORMULA_CONSTANTS, tree.name) ? FORMULA_CONSTANTS[tree.name]!
      : Object.hasOwn(values, tree.name) ? values[tree.name]! : Number.NaN;
    case "negate": return -evaluateFormula(tree.argument, values);
    case "call": return FORMULA_FUNCTIONS[tree.name]!.apply(...tree.args.map((arg) => evaluateFormula(arg, values)));
    case "binary": {
      const left = evaluateFormula(tree.left, values), right = evaluateFormula(tree.right, values);
      switch (tree.operator) {
        case "+": return left + right;
        case "-": return left - right;
        case "*": return left * right;
        case "/": return left / right;
        case "^": return left ** right;
      }
    }
  }
}

const PRECEDENCE: Readonly<Record<Operator, number>> = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 4 };
const SHOWN: Readonly<Record<Operator, string>> = { "+": " + ", "-": " − ", "*": " × ", "/": " ÷ ", "^": "^" };
const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const precedence = (node: FormulaNode) => node.type === "binary" ? PRECEDENCE[node.operator] : node.type === "negate" ? 3 : 5;

/**
 * The formula as the lesson page shows it: × and ÷ for multiplication and division, the minus sign −, π for pi, a small
 * whole power as a superscript (v²), and only the parentheses the order of operations needs.
 */
export function formulaText(tree: FormulaNode): string {
  const wrap = (node: FormulaNode, needs: boolean) => needs ? `(${formulaText(node)})` : formulaText(node);
  switch (tree.type) {
    case "number": return String(tree.value);
    case "name": return tree.name === "pi" ? "π" : tree.name;
    case "negate": return `−${wrap(tree.argument, precedence(tree.argument) < 4)}`;
    case "call": return `${tree.name}(${tree.args.map(formulaText).join(", ")})`;
    case "binary": {
      const own = PRECEDENCE[tree.operator];
      if (tree.operator === "^") {
        const base = wrap(tree.left, precedence(tree.left) <= own);
        const small = tree.right.type === "number" && Number.isInteger(tree.right.value) && tree.right.value >= 0 && tree.right.value <= 9;
        return small ? `${base}${SUPERSCRIPT[(tree.right as { value: number }).value]}` : `${base}^${wrap(tree.right, precedence(tree.right) < own)}`;
      }
      // The right side of − and ÷ keeps its parentheses at the same level: a − (b − c) is not a − b − c.
      const right = wrap(tree.right, precedence(tree.right) < own || (precedence(tree.right) === own && (tree.operator === "-" || tree.operator === "/")));
      return `${wrap(tree.left, precedence(tree.left) < own)}${SHOWN[tree.operator]}${right}`;
    }
  }
}
