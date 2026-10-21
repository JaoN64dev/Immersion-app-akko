// When something goes wrong on a page (an error nothing caught), akko offers once to report it:
// a small card with "report it", which opens Settings → Help with the error filled in
// (scripts/pages/help.js). Nothing is sent without the person sending the form. Each different
// error asks once per session; errors from browser extensions and harmless browser noise don't ask.

const ASKED = "akko-oops-asked";
const DRAFT = "akko-report-draft";

const NOISE = /ResizeObserver loop|AbortError|The play\(\) request was interrupted|NotAllowedError|Script error\.?$|Load failed|Failed to fetch|NetworkError/i;

function asked(key) {
    try {
        const list = JSON.parse(sessionStorage.getItem(ASKED) || "[]");
        if (list.includes(key)) return true;
        sessionStorage.setItem(ASKED, JSON.stringify([...list, key].slice(-20)));
    } catch { /* no session storage: ask anyway */ }
    return false;
}

function offer(message, stack) {
    if (!message || NOISE.test(message) || /chrome-extension:|moz-extension:/.test(stack || "")) return;
    if (asked(message.slice(0, 200)) || document.querySelector(".oops")) return;
    const card = document.createElement("div");
    card.className = "oops";
    card.setAttribute("role", "alert");
    card.innerHTML = `<p>Something went wrong on this page.</p>
        <div class="row-buttons"><button type="button" class="oops-report">report it</button><button type="button" class="oops-close">not now</button></div>`;
    card.querySelector(".oops-close").onclick = () => card.remove();
    card.querySelector(".oops-report").onclick = () => {
        const where = location.pathname + location.hash;
        try { sessionStorage.setItem(DRAFT, JSON.stringify({ what: "", error: `${message}\n${stack || ""}\n(on ${where})`.slice(0, 4000) })); } catch { /* the form starts empty */ }
        card.remove();
        if (location.pathname === "/settings.html") { location.hash = "help-section"; location.reload(); } else location.href = "/settings.html#help-section";
    };
    document.body.appendChild(card);
}

export function start() {
    window.addEventListener("error", (e) => offer(e.message, e.error && e.error.stack));
    window.addEventListener("unhandledrejection", (e) => {
        const r = e.reason;
        offer(r instanceof Error ? r.message : String(r ?? ""), r instanceof Error ? r.stack : "");
    });
}
