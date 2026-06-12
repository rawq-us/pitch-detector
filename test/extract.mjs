// Extraction helpers: pull the inline <script> out of index.html and lift
// individual top-level declarations from it so they can be tested in Node.
//
// This works because the app deliberately keeps its DSP worker
// (memoWorkerMain) and export builders self-contained — see docs/TESTING.md.
// Constraint: extracted functions must not contain string literals with
// unbalanced braces (the matcher counts braces textually).
import { readFileSync } from "node:fs";

export function extractScript(){
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const m = html.match(/^<script>\n([\s\S]*?)^<\/script>$/m);
  if (!m) throw new Error("inline <script> not found in index.html");
  return m[1];
}

// Lift `function NAME(...){...}` including its full body (brace counting).
export function extractFunction(src, name){
  const sig = new RegExp("(?:^|\\n)(?:async )?function " + name + "\\s*\\(");
  const m = sig.exec(src);
  if (!m) throw new Error("function " + name + " not found");
  const i = m.index;
  const start = src.indexOf("{", i);
  let depth = 0, j = start;
  do {
    const ch = src[j];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    j++;
  } while (depth > 0 && j < src.length);
  if (depth !== 0) throw new Error("unbalanced braces extracting " + name);
  return src.slice(i, j).trim();
}

// Lift a single-line `const NAME = …;` declaration (our shared constants are one-liners).
export function extractConstLine(src, name){
  const re = new RegExp("^const " + name + "\\s*=.*$", "m");
  const m = re.exec(src);
  if (!m) throw new Error("const " + name + " not found (expected a one-line declaration)");
  return m[0];
}
