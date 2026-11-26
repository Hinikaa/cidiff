const ENTITY_MAP = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
};
export function unescapeXml(value) {
    return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (full, entity) => {
        if (entity in ENTITY_MAP) {
            return ENTITY_MAP[entity];
        }
        if (entity.startsWith("#x")) {
            const code = Number.parseInt(entity.slice(2), 16);
            return Number.isFinite(code) ? String.fromCodePoint(code) : full;
        }
        if (entity.startsWith("#")) {
            const code = Number.parseInt(entity.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : full;
        }
        return full;
    });
}
function parseAttributes(attrSource) {
    const attrs = {};
    const attrRe = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let match;
    while ((match = attrRe.exec(attrSource)) !== null) {
        const key = match[1];
        const rawVal = match[2] !== undefined ? match[2] : (match[3] ?? "");
        attrs[key] = unescapeXml(rawVal);
    }
    return attrs;
}
function stripCommentsAndProlog(xml) {
    return xml
        .replace(/<\?[\s\S]*?\?>/g, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, inner) => inner.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
}
function tokenizeTags(xml) {
    const tokens = [];
    let i = 0;
    const len = xml.length;
    while (i < len) {
        const start = xml.indexOf("<", i);
        if (start === -1) {
            break;
        }
        let j = start + 1;
        let quote = null;
        while (j < len) {
            const ch = xml[j];
            if (quote !== null) {
                if (ch === quote) {
                    quote = null;
                }
            }
            else if (ch === "\"" || ch === "'") {
                quote = ch;
            }
            else if (ch === ">") {
                break;
            }
            j += 1;
        }
        if (j >= len) {
            break;
        }
        const rawTag = xml.slice(start + 1, j).trim();
        i = j + 1;
        if (!rawTag || rawTag.startsWith("!")) {
            continue;
        }
        const closing = rawTag.startsWith("/");
        const selfClosing = !closing && rawTag.endsWith("/");
        const body = rawTag
            .slice(closing ? 1 : 0, selfClosing ? rawTag.length - 1 : rawTag.length)
            .trim();
        const spaceIdx = body.search(/\s/);
        const name = (spaceIdx === -1 ? body : body.slice(0, spaceIdx)).toLowerCase();
        const attrPart = spaceIdx === -1 ? "" : body.slice(spaceIdx + 1);
        tokens.push({
            name,
            closing,
            selfClosing,
            attrs: closing ? {} : parseAttributes(attrPart),
        });
    }
    return tokens;
}
function parseTimeSec(raw) {
    if (!raw) {
        return 0;
    }
    const normalized = raw.replace(/,/g, "").trim();
    const val = Number.parseFloat(normalized);
    return Number.isFinite(val) && val >= 0 ? val : 0;
}
export function parseJunitXml(content) {
    const cleaned = stripCommentsAndProlog(content);
    const tokens = tokenizeTags(cleaned);
    const results = [];
    const suiteStack = [];
    let activeCase = null;
    for (const token of tokens) {
        if (token.name === "testsuite") {
            if (token.closing) {
                suiteStack.pop();
            }
            else if (!token.selfClosing) {
                suiteStack.push(token.attrs.name || "default");
            }
            continue;
        }
        if (token.name === "testcase") {
            if (token.closing) {
                if (activeCase !== null) {
                    results.push(activeCase);
                    activeCase = null;
                }
                continue;
            }
            const currentSuite = suiteStack.length > 0 ? suiteStack[suiteStack.length - 1] : "default";
            const suite = token.attrs.classname || currentSuite || "default";
            const name = token.attrs.name || "unnamed";
            const durationSec = parseTimeSec(token.attrs.time);
            if (token.selfClosing) {
                results.push({ suite, name, durationSec, status: "pass" });
            }
            else {
                activeCase = { suite, name, durationSec, status: "pass" };
            }
            continue;
        }
        if (activeCase !== null && !token.closing) {
            if (token.name === "failure" || token.name === "error") {
                activeCase.status = "fail";
            }
            else if (token.name === "skipped" && activeCase.status !== "fail") {
                activeCase.status = "skip";
            }
        }
    }
    if (activeCase !== null) {
        results.push(activeCase);
    }
    return results;
}
