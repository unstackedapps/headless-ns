// Reads the YAML subset skill headers use: `key: value`, quoted strings, `|` and `>` blocks,
// lists of plain values, and one level of nested maps. Anything else fails with its line number.

const KEY = /^([A-Za-z0-9_][A-Za-z0-9_.-]*):(?:\s+(.*))?$/;

function unsupported(line) {
  const error = new Error(`This frontmatter uses YAML the app can't read (line ${line}).`);
  error.status = 400;
  return error;
}

function scalar(raw, line) {
  const text = raw.trim();
  if (text.startsWith('"')) {
    if (!/^"(?:[^"\\]|\\.)*"$/.test(text)) throw unsupported(line);
    try {
      return JSON.parse(text.replace(/\\'/g, "'"));
    } catch {
      throw unsupported(line);
    }
  }
  if (text.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(text)) throw unsupported(line);
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text.startsWith("[")) {
    if (!text.endsWith("]")) throw unsupported(line);
    const inner = text.slice(1, -1).trim();
    return inner ? inner.split(",").map((part) => scalar(part, line)) : [];
  }
  if (/^[{&*!|>@`%]/.test(text)) throw unsupported(line);
  return text.replace(/\s+#.*$/, "");
}

const indentOf = (line) => line.length - line.trimStart().length;

// `text` is the frontmatter only. `first` is its first line's number in the file, for errors.
export function parseYaml(text, first = 1) {
  const lines = String(text).split(/\r?\n/);
  const out = {};
  let i = 0;
  const blank = (line) => !line.trim() || line.trimStart().startsWith("#");
  // Indented lines after line i, for blocks, nested maps, lists and wrapped values.
  // Each entry is [text, file line number].
  const indented = () => {
    const taken = [];
    while (i + 1 < lines.length && (blank(lines[i + 1]) || indentOf(lines[i + 1]) > 0)) {
      i += 1;
      taken.push([lines[i], first + i]);
    }
    while (taken.length && !taken.at(-1)[0].trim()) taken.pop();
    return taken;
  };
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    const number = first + i;
    if (blank(line)) continue;
    if (/^\t| \t/.test(line) || indentOf(line) > 0) throw unsupported(number);
    const match = KEY.exec(line.trimEnd());
    if (!match) throw unsupported(number);
    const [, key, rest = ""] = match;
    const value = rest.trim();
    if (/^[|>][+-]?$/.test(value)) {
      const block = indented().map(([item]) => item);
      const depth = Math.min(...block.filter((item) => item.trim()).map(indentOf));
      const body = block.map((item) => item.slice(depth));
      const joined = value[0] === "|" ? body.join("\n") : body.join("\n").replace(/([^\n])\n(?=[^\n])/g, "$1 ");
      out[key] = value.endsWith("-") ? joined : `${joined}\n`;
    } else if (value) {
      const wrapped = indented().map(([item]) => item.trim()).filter(Boolean);
      out[key] = scalar([value, ...wrapped].join(" "), number);
    } else {
      const block = indented().filter(([item]) => !blank(item));
      if (!block.length) out[key] = "";
      else if (block.every(([item]) => item.trimStart().startsWith("- "))) {
        out[key] = block.map(([item, at]) => scalar(item.trimStart().slice(2), at));
      } else {
        const map = {};
        const depth = indentOf(block[0][0]);
        block.forEach(([item, at]) => {
          const inner = KEY.exec(item.trim());
          if (indentOf(item) !== depth || !inner || /^[|>]/.test(inner[2] || "")) throw unsupported(at);
          map[inner[1]] = scalar(inner[2] || "", at);
        });
        out[key] = map;
      }
    }
  }
  return out;
}

// Splits `---` frontmatter from the body. Returns null when the file has none.
export function readFrontmatter(text, limit = 64_000) {
  const source = String(text).replace(/^﻿/, "");
  if (!/^---\r?\n/.test(source)) return null;
  const close = /\r?\n---[ \t]*(?:\r?\n|$)/.exec(source.slice(3));
  if (!close) {
    const error = new Error("The frontmatter has no closing ---.");
    error.status = 400;
    throw error;
  }
  const header = source.slice(source.indexOf("\n") + 1, 3 + close.index);
  if (header.length > limit) {
    const error = new Error("The frontmatter is over 64 KB.");
    error.status = 400;
    throw error;
  }
  return { data: parseYaml(header, 2), body: source.slice(3 + close.index + close[0].length) };
}
