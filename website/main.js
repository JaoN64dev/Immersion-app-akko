// The download buttons point at the newest release's files: GitHub says which they are, so this
// page never needs editing for a new version. Without an answer (offline, GitHub's rate limit),
// the buttons keep their link to the releases page.

const REPO = "JaoN64dev/Immersion-app-akko";

const size = (bytes) => `${Math.round(bytes / 1e6)} MB`;
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

async function newestRelease() {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    return res.json();
}

function point(id, asset, label) {
    const a = document.getElementById(id);
    if (!a || !asset) return;
    a.href = asset.browser_download_url;
    a.textContent = `⬇ ${label}`;
    const note = document.getElementById(`${id}-size`);
    if (note) note.textContent = `${asset.name} · ${size(asset.size)} · Windows 10 / 11, 64-bit`;
}

newestRelease().then((r) => {
    const version = String(r.tag_name || "").replace(/^v/i, "");
    const setup = r.assets.find((a) => /setup.*\.exe$/i.test(a.name));
    const portable = r.assets.find((a) => /portable.*\.exe$/i.test(a.name));
    point("dl-setup", setup, `Installer ${version}`);
    point("dl-portable", portable, `Portable ${version}`);
    if (setup) {
        document.getElementById("hero-download").href = setup.browser_download_url;
        document.getElementById("hero-download").textContent = `⬇ Download akko ${version}`;
        document.getElementById("hero-version").textContent = `for Windows · ${size(setup.size)} · free · open source`;
    }
    const line = document.getElementById("release-line");
    line.textContent = "";
    const notes = document.createElement("a");
    notes.href = r.html_url;
    notes.textContent = "what's new";
    line.append(`akko ${version}, released ${day(r.published_at)} (`, notes, ")");
}).catch(() => { /* the links to the releases page stay */ });
