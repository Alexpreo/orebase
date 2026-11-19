/**
 * Parses the markdown subset the chat model emits (paragraphs, **bold**, "-"/"1." lists,
 * pipe tables, # headings) into blocks. Inline text keeps citation tags for the renderer.
 * shortcut: no nested lists, links or code; upgrade to a markdown library if answers need them.
 */
export type Inline = { text: string; bold: boolean };
export type Block =
  | { kind: "p"; lines: Inline[][] }
  | { kind: "h"; text: Inline[] }
  | { kind: "ul" | "ol"; items: Inline[][] }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][] };

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (!part) continue;
    const bold = part.startsWith("**") && part.endsWith("**") && part.length > 4;
    out.push({ text: bold ? part.slice(2, -2) : part, bold });
  }
  return out;
}

const cells = (line: string) =>
  line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => parseInline(c.trim()));
const isRule = (line: string) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line.trim());

export function parseAnswer(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) {
      i++;
      continue;
    }
    if (t.startsWith("|")) {
      const tbl: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) tbl.push(lines[i++]);
      const ruleAt = tbl.findIndex(isRule);
      if (ruleAt === 1) {
        blocks.push({ kind: "table", head: cells(tbl[0]), rows: tbl.slice(2).map(cells) });
      } else {
        blocks.push({ kind: "p", lines: tbl.map((l) => parseInline(l)) });
      }
      continue;
    }
    const h = /^#{1,6}\s+(.*)$/.exec(t);
    if (h) {
      blocks.push({ kind: "h", text: parseInline(h[1]) });
      i++;
      continue;
    }
    const listKind = /^[-*]\s+/.test(t) ? "ul" : /^\d+[.)]\s+/.test(t) ? "ol" : null;
    if (listKind) {
      const re = listKind === "ul" ? /^[-*]\s+/ : /^\d+[.)]\s+/;
      const items: Inline[][] = [];
      while (i < lines.length && re.test(lines[i].trim())) items.push(parseInline(lines[i++].trim().replace(re, "")));
      blocks.push({ kind: listKind, items });
      continue;
    }
    const para: Inline[][] = [];
    while (i < lines.length) {
      const l = lines[i].trim();
      if (!l || l.startsWith("|") || /^#{1,6}\s/.test(l) || /^([-*]|\d+[.)])\s+/.test(l)) break;
      para.push(parseInline(l));
      i++;
    }
    blocks.push({ kind: "p", lines: para });
  }
  return blocks;
}
