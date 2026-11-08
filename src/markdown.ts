export type Span = { kind: "text" | "code" | "strong" | "em" | "link"; text: string; href?: string };

export type Block =
  | { type: "p"; text: string }
  | { type: "h"; level: number; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "pre"; text: string };

const inline = /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*([^*]+)\*/g;

export function inlineSpans(input: string): Span[] {
  const spans: Span[] = [];
  let last = 0;
  for (const match of input.matchAll(inline)) {
    const index = match.index ?? 0;
    if (index > last) spans.push({ kind: "text", text: input.slice(last, index) });
    if (match[1] != null) spans.push({ kind: "code", text: match[1] });
    else if (match[2] != null || match[3] != null) spans.push({ kind: "strong", text: match[2] ?? match[3] });
    else if (match[4] != null) spans.push({ kind: "link", text: match[4], href: match[5] });
    else if (match[6] != null) spans.push({ kind: "em", text: match[6] });
    last = index + match[0].length;
  }
  if (last < input.length) spans.push({ kind: "text", text: input.slice(last) });
  return spans;
}

function isFence(line: string) {
  return line.startsWith("```");
}

function isHeading(line: string) {
  return /^(#{1,3})\s+\S/.test(line);
}

function isBullet(line: string) {
  return /^[-*]\s+\S/.test(line);
}

function isNumbered(line: string) {
  return /^\d+\.\s+\S/.test(line);
}

export function markdownBlocks(source: string): Block[] {
  // shortcut: a heading mark later on the same line starts its own block
  const lines = source.replace(/\r\n/g, "\n").replace(/ +(?=#{1,3} )/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (isFence(line)) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !isFence(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "pre", text: body.join("\n") });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "h", level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }
    if (isBullet(line)) {
      const items: string[] = [];
      while (index < lines.length && isBullet(lines[index])) {
        items.push(lines[index].replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    if (isNumbered(line)) {
      const items: string[] = [];
      while (index < lines.length && isNumbered(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }
    const para: string[] = [];
    while (index < lines.length && lines[index].trim() && !isFence(lines[index]) && !isHeading(lines[index]) && !isBullet(lines[index]) && !isNumbered(lines[index])) {
      para.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: "p", text: para.join(" ") });
  }
  return blocks;
}
