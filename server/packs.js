// Dictionary packs: one download per language, from the project that makes the dictionary, so a
// language in the picker works without hunting for a file. Only free dictionaries under a licence
// that lets us point at them are here — akko downloads them on your machine and keeps them in
// ./data like the Japanese ones (server/dictionaries.js). Nothing is bundled with akko.
//
// Adding a pack: `lang` is the tag in scripts/core/target.js, `url` a release asset that is not
// going to move (a versioned tag, not "latest").

const packs = {
    ko: [{
        id: 'ko-krdict',
        lang: 'ko',
        title: 'KRDICT — Korean, with English meanings',
        url: 'https://github.com/Lyroxide/yomitan-ko-dic/releases/download/1.0.0/KO-EN.KRDICT.zip',
        size: 17100000,
        licence: 'CC BY-SA 2.0 KR',
        thanks: '국립국어원 (National Institute of Korean Language) and Lyroxide/yomitan-ko-dic',
    }],
    cmn: [{
        id: 'zh-cedict',
        lang: 'cmn',
        title: 'CC-CEDICT — Chinese, with English meanings and pinyin',
        url: 'https://github.com/MarvNC/cc-cedict-yomitan/releases/download/2026-11-02/CC-CEDICT.zip',
        size: 8000000,
        licence: 'CC BY-SA 4.0',
        thanks: 'CC-CEDICT and MarvNC/cc-cedict-yomitan',
    }],
    yue: [{
        id: 'yue-canto',
        lang: 'yue',
        title: 'CC-Canto — Cantonese, with English meanings and Jyutping',
        url: 'https://github.com/MarvNC/cc-cedict-yomitan/releases/download/2026-11-02/CC-Canto.zip',
        size: 1900000,
        licence: 'CC BY-SA 3.0',
        thanks: 'CC-Canto and MarvNC/cc-cedict-yomitan',
    }],
};

// What Settings shows for a language, without the addresses (they are not the page's business)
function list(lang) {
    return (packs[lang] || []).map(({ id, title, size, licence, thanks }) => ({ id, title, size, licence, thanks }));
}

const find = (id) => Object.values(packs).flat().find((p) => p.id === id) || null;

// Download it and install it the way an uploaded .zip is installed. Errors here are about the
// download, so they go back to Settings as a message to show.
async function download(pack) {
    let res;
    try {
        res = await fetch(pack.url, { redirect: 'follow', signal: AbortSignal.timeout(5 * 60e3) });
    } catch (err) {
        throw new Error(`couldn't reach ${new URL(pack.url).host} (${err.message})`);
    }
    if (!res.ok) throw new Error(`${new URL(pack.url).host} answered ${res.status}`);
    const said = Number(res.headers.get('content-length')) || pack.size;
    if (said > 400e6) throw new Error('that download is too big');
    return Buffer.from(await res.arrayBuffer());
}

module.exports = { list, find, download, packs };
