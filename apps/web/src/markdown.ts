/**
 * Markdown, as an AI assistant writes it, turned into HTML to read.
 *
 * The AI accounts check pastes back an assistant's answer: headings, lists,
 * bold, tables. Shown raw it is a wall of hashes and asterisks. This draws the
 * part of Markdown such answers use, and nothing else.
 *
 * Safe by construction: every character of the text is escaped first, and the
 * only markup that comes out is the fixed set of tags written here. A link is
 * kept only when it goes to http or https, and opens apart from the books. The
 * text is somebody's pasted answer, so it is treated as untrusted throughout.
 */

function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Bold, italic, code and links within a line, on text already escaped. */
function inline(escaped: string): string {
  // Code and links first, and kept apart, so nothing inside them -- an
  // underscore in an address -- is read as anything else.
  const kept: string[] = [];
  const keep = (html: string): string => {
    kept.push(html);
    return `\u0000${kept.length - 1}\u0000`;
  };
  let out = escaped
    .replace(/`([^`]+)`/g, (_, code: string) => keep(`<code>${code}</code>`))
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label: string, href: string) =>
      keep(`<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`));
  out = out
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, "$1<em>$2</em>");
  return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => kept[Number(i)] ?? "");
}

/** A table's row, split into its cells. */
function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

const isTableRule = (line: string): boolean => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

export function markdownToHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;

  const endParagraph = (): void => {
    if (paragraph.length > 0) out.push(`<p>${paragraph.map((l) => inline(escape(l))).join("<br>")}</p>`);
    paragraph = [];
  };
  const endList = (): void => {
    if (list !== null) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(escape(i))}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  const endAll = (): void => {
    endParagraph();
    endList();
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";

    // A fenced block of code, as it is.
    if (/^\s*```/.test(line)) {
      endAll();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i] ?? "")) {
        code.push(lines[i] ?? "");
        i += 1;
      }
      out.push(`<pre><code>${escape(code.join("\n"))}</code></pre>`);
      continue;
    }

    if (line.trim() === "") {
      endAll();
      continue;
    }

    // Headings: an answer's "#" is the top of a part of the page, not of it,
    // so they start a level under the page's own headings.
    const heading = /^\s*(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading !== null) {
      endAll();
      const level = Math.min(6, (heading[1] ?? "#").length + 3);
      out.push(`<h${level}>${inline(escape(heading[2] ?? ""))}</h${level}>`);
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      endAll();
      out.push("<hr>");
      continue;
    }

    // A table: a row of cells, then its rule, then the rest of its rows.
    if (line.includes("|") && isTableRule(lines[i + 1] ?? "")) {
      endAll();
      const head = cells(line);
      const body: string[][] = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? "").includes("|") && (lines[i] ?? "").trim() !== "") {
        body.push(cells(lines[i] ?? ""));
        i += 1;
      }
      i -= 1;
      out.push(
        `<table class="report-table md-table"><thead><tr>${head.map((c) => `<th>${inline(escape(c))}</th>`).join("")}</tr></thead>` +
          `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(escape(c))}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
      );
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet !== null || numbered !== null) {
      endParagraph();
      const tag = bullet !== null ? "ul" : "ol";
      if (list !== null && list.tag !== tag) endList();
      if (list === null) list = { tag, items: [] };
      list.items.push((bullet ?? numbered)?.[1] ?? "");
      continue;
    }

    // A line under a list item, indented, carries on that item.
    if (list !== null && /^\s{2,}\S/.test(line)) {
      const last = list.items.length - 1;
      list.items[last] = `${list.items[last] ?? ""} ${line.trim()}`;
      continue;
    }

    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote !== null) {
      endAll();
      out.push(`<blockquote>${inline(escape(quote[1] ?? ""))}</blockquote>`);
      continue;
    }

    endList();
    paragraph.push(line.trim());
  }
  endAll();
  return out.join("\n");
}
