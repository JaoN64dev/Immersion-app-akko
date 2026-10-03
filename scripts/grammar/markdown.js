// Just enough Markdown for lesson explanations: headings, paragraphs, lists, > notes,
// tables, **bold**, *italic*, `code` and [links](url). Everything is escaped first.

import { escapeHtml } from "../core/utils.js";

function inline(text) {
    // `code` is left alone; formatting applies to the parts between
    return text.split(/(`[^`]+`)/).map((part) => {
        if (/^`[^`]+`$/.test(part)) return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
        return escapeHtml(part)
            .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
            .replace(/\*(.+?)\*/g, "<i>$1</i>")
            .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/|#)[^)\s]*)\)/g, (m, label, href) =>
                `<a href="${href}"${href.startsWith("http") ? ` target="_blank" rel="noopener"` : ""}>${label}</a>`);
    }).join("");
}

const cells = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function markdown(src) {
    const out = [];
    let para = [], list = null, quote = [], table = [];

    const flush = () => {
        if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
        if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`);
        if (quote.length) out.push(`<blockquote>${quote.map(inline).join("<br>")}</blockquote>`);
        if (table.length) {
            const [head, ...body] = table;
            // a header row of empty cells (| | |) means "no header"
            const thead = head.some(Boolean) ? `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>` : "";
            out.push(`<div class="table-wrap"><table>${thead}`
                + `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
        }
        para = []; list = null; quote = []; table = [];
    };

    for (const line of src.split("\n")) {
        const t = line.trim();
        let m;
        if (!t) { flush(); continue; }
        if ((m = t.match(/^(#{1,6})\s+(.*)$/))) {
            flush();
            const tag = m[1].length <= 2 ? "h3" : "h4";
            out.push(`<${tag}>${inline(m[2])}</${tag}>`);
        } else if (t.startsWith(">")) {
            if (!quote.length) flush();
            quote.push(t.replace(/^>\s?/, ""));
        } else if (t.startsWith("|")) {
            if (!table.length) flush();
            if (!(t.includes("-") && /^[\s:|-]+$/.test(t))) table.push(cells(t));      // skip the |---| line
        } else if ((m = t.match(/^([-*]|\d+\.)\s+(.*)$/))) {
            const tag = /\d/.test(m[1]) ? "ol" : "ul";
            if (!list || list.tag !== tag) { flush(); list = { tag, items: [] }; }
            list.items.push(m[2]);
        } else {
            if (list || quote.length || table.length) flush();
            para.push(t);
        }
    }
    flush();
    return out.join("\n");
}
