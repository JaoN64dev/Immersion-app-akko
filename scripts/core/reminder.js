// Nudge to download a backup when the last one (or first visit) was over two weeks ago.
// At most once a day, and only once there's something worth backing up.

import { store } from "./utils.js";
import { idbCount } from "./idb.js";
import { toast } from "./toast.js";

const DAY = 864e5;
const EVERY = 14 * DAY;

export async function remindBackup() {
    const now = Date.now();
    let firstSeen = store.get("akko-first-seen", null);
    if (!firstSeen) {
        firstSeen = now;
        store.set("akko-first-seen", now);
    }
    const last = store.get("akko-last-backup", null);
    const since = last || firstSeen;
    if (now - since < EVERY || now - store.get("akko-backup-reminded", 0) < DAY) return;

    const hasData = Object.keys(store.get("akko-words", {})).length > 0
        || (await idbCount("mined").catch(() => 0)) > 0
        || (await idbCount("texts").catch(() => 0)) > 0;
    if (!hasData) return;

    store.set("akko-backup-reminded", now);
    const days = Math.floor((now - since) / DAY);
    toast(last ? `it's been ${days} days since your last backup.` : `you've used the site for ${days} days without a backup.`,
        false, { action: { label: "back up now", href: "/settings.html#backup-section" }, timeout: 15000 });
}
