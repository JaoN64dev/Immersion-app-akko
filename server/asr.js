// Local speech recognition (3.0, feature 9): subtitles for audio you already have — a download, a
// rip, a podcast without a transcript — made on your own machine.
//
// Nothing here downloads a model or calls a service: the free-hosting rule of 3.0 (docs/ideas-3.0.md)
// means the CPU is yours. akko looks for a Whisper-class tool the user already installed
// (whisper.cpp's `whisper-cli`, OpenAI's `whisper`, `faster-whisper`), tells them what is missing if
// nothing is there, and hands back an SRT — the same shape the players already read, so a
// transcription goes through the ordinary subtitle path.

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const express = require('express');
const { spawn } = require('child_process');

// name -> how to call it
const TOOLS = [
    { id: 'whisper-cli', names: ['whisper-cli', 'whisper-cpp', 'main', 'whisper.cpp'], family: 'cpp' },
    { id: 'whisper', names: ['whisper'], family: 'openai' },
    { id: 'faster-whisper', names: ['faster-whisper', 'faster_whisper'], family: 'faster' },
];

// Where a model could be: whisper.cpp wants a .bin, the python ones pick their own
const MODEL_HINTS = [
    path.join(os.homedir(), '.cache', 'akko', 'whisper'),
    path.join(os.homedir(), '.cache', 'whisper'),
    path.join(os.homedir(), '.local', 'share', 'whisper'),
];

// The base model akko can download for whisper.cpp: the multilingual base, about 148 MB.
// akko never ships a model: this pinned URL and its sha256 are the one click from "a tool is
// installed" to "working". The model is published with the whisper.cpp models
// (huggingface.co/ggerganov/whisper.cpp); akko has no place to re-host it, so AKKO_WHISPER_MODEL
// stays the escape hatch for any other model or build.
const PINNED_MODEL = {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    file: 'ggml-base.bin',
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
    size: 147951465,
};

// Is this a program we can run? (PATH, plus the .exe on Windows)
function which(name) {
    if (!name) return null;
    if (name.includes(path.sep) || name.includes('/')) return fs.existsSync(name) ? name : null;
    const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
    const ends = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
    for (const dir of dirs) {
        for (const end of ends) {
            const full = path.join(dir, name + end);
            try {
                if (fs.statSync(full).isFile()) return full;
            } catch { /* not here */ }
        }
    }
    return null;
}

function models() {
    const out = [];
    for (const dir of MODEL_HINTS) {
        let names = [];
        try { names = fs.readdirSync(dir).filter((n) => /\.(bin|pt|ct2)$/i.test(n)); } catch { continue; }
        for (const n of names) {
            let size;
            try { size = fs.statSync(path.join(dir, n)).size; } catch { continue; }
            out.push({ file: path.join(dir, n), size });
        }
    }
    return out;
}

// What Settings shows: is there a tool, which one, and is there a model for it
function status() {
    const asked = process.env.AKKO_WHISPER;                 // "point it at yours": any path or command
    const found = [];
    if (asked) {
        const at = which(asked.split(/\s+/)[0]);
        if (at) found.push({ id: path.basename(at), path: at, family: /whisper-cli|whisper-cpp|main/.test(at) ? 'cpp' : 'openai', fromEnv: true });
    }
    for (const tool of TOOLS) {
        if (found.length && !process.env.AKKO_WHISPER) break;
        for (const name of tool.names) {
            const at = which(name);
            if (at) { found.push({ id: name, path: at, family: tool.family }); break; }
        }
    }
    const model = process.env.AKKO_WHISPER_MODEL && fs.existsSync(process.env.AKKO_WHISPER_MODEL) ? process.env.AKKO_WHISPER_MODEL : null;
    const all = models();
    return {
        tools: found,
        model: model || (all[0] && all[0].file) || null,
        models: all,
        ready: !!(found.length && (found[0].family !== 'cpp' || model || all.length)),
        // said in the app when there is nothing: what to install, and that nothing is sent anywhere
        help: found.length
            ? (found[0].family === 'cpp' && !model && !all.length
                ? 'whisper.cpp needs a model: download one (e.g. ggml-base.bin) into ~/.cache/akko/whisper, or set AKKO_WHISPER_MODEL.'
                : '')
            : 'no speech recognition found. Install whisper.cpp (whisper-cli), OpenAI whisper, or faster-whisper, and akko will use it on this machine — nothing is uploaded.',
    };
}

// the command line for the tool we found, writing an SRT next to `base`
function command(tool, audio, base, lang) {
    const languageCodes = { ja: 'ja', en: 'en', ko: 'ko', cmn: 'zh', yue: 'yue', de: 'de', es: 'es', it: 'it', fr: 'fr', ru: 'ru', pt: 'pt' };
    const l = languageCodes[lang] || lang || 'auto';
    if (tool.family === 'cpp') {
        const model = (status().model) || 'model.bin';
        return { args: ['-m', model, '-f', audio, '-osrt', '-of', base, '-l', l], srt: `${base}.srt` };
    }
    if (tool.family === 'faster') {
        return { args: [audio, '--output_format', 'srt', '--output_dir', path.dirname(base), '--language', l], srt: path.join(path.dirname(base), path.basename(base) + '.srt') };
    }
    return { args: [audio, '--model', 'base', '--output_format', 'srt', '--output_dir', path.dirname(base), '--language', l], srt: path.join(path.dirname(base), path.basename(base) + '.srt') };
}

// Download the pinned base model into the first model folder (~/.cache/akko/whisper),
// checking its sha256 as it comes in. A second call while one is in flight waits on the same
// download. `dir`, `url`, `hash` and `file` are test overrides; production uses the pinned
// model and only touches the network for this one file.
    let downloading = null;
    async function downloadModel({ url = PINNED_MODEL.url, hash = PINNED_MODEL.sha256,
        file = PINNED_MODEL.file, dir = MODEL_HINTS[0] } = {}) {
        if (downloading) return downloading;
        const done = (async () => {
            fs.mkdirSync(dir, { recursive: true });
            const target = path.join(dir, file);
            const tmp = `${target}.part`;
            const have = fs.existsSync(target) ? await sha256Of(target).catch(() => null) : null;
            if (have === hash) return target;
            const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30 * 60e3) });
            if (!res.ok) throw new Error(`the model server answered ${res.status}`);
            const body = res.body;
            if (!body) throw new Error('the model download came back empty');
            const limit = Number(res.headers.get('content-length')) || PINNED_MODEL.size;
            if (limit > 700e6) throw new Error('that model is too big');
            const out = fs.createWriteStream(tmp);
            const digest = crypto.createHash('sha256');
            let got = 0;
            for await (const chunk of body) {
                digest.update(chunk);
                got += chunk.length;
                if (got > 700e6) throw new Error('that model is too big');
                out.write(chunk);
            }
            await new Promise((resolve, reject) => { out.end(); out.on('finish', resolve); out.on('error', reject); });
            const actual = digest.digest('hex');
            if (actual !== hash) {
                try { fs.rmSync(tmp, { force: true }); } catch { /* gone already */ }
                throw new Error(`the model's checksum didn't match (expected ${hash.slice(0, 12)}…, got ${actual.slice(0, 12)}…): download ggml-base.bin yourself and set AKKO_WHISPER_MODEL`);
            }
            fs.renameSync(tmp, target);
            return target;
        })();
        downloading = done.finally(() => { downloading = null; });
        return downloading;
    }

    function sha256Of(file) {
        return new Promise((resolve, reject) => {
            const digest = crypto.createHash('sha256');
            const stream = fs.createReadStream(file);
            stream.on('data', (b) => digest.update(b));
            stream.on('end', () => resolve(digest.digest('hex')));
            stream.on('error', reject);
        });
    }

    // Transcribe one audio file. Resolves with the SRT text; rejects with a sentence meant for the page.
function transcribe(audio, { lang = 'ja', timeout = 30 * 60e3 } = {}) {
    return new Promise((resolve, reject) => {
        const found = status();
        if (!found.tools.length) return reject(new Error(found.help));
        const tool = found.tools[0];
        if (tool.family === 'cpp' && !found.model) return reject(new Error(found.help));
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-asr-'));
        const base = path.join(dir, path.parse(audio).name);
        const { args, srt } = command(tool, audio, base, lang);
        const child = spawn(tool.path, args, { cwd: dir });
        let said = '';
        child.stdout.on('data', (b) => { said += b.toString(); });
        child.stderr.on('data', (b) => { said += b.toString(); });
        const timer = setTimeout(() => { child.kill(); reject(new Error('recognition took too long (30 minutes)')); }, timeout);
        child.on('error', (err) => { clearTimeout(timer); reject(new Error(`${tool.id} did not start: ${err.message}`)); });
        child.on('close', (code) => {
            clearTimeout(timer);
            let text = null;
            try { text = fs.readFileSync(srt, 'utf8'); } catch { /* look for it next to the tool's output */ }
            if (!text) {
                try {
                    const found2 = fs.readdirSync(dir).find((n) => n.endsWith('.srt'));
                    if (found2) text = fs.readFileSync(path.join(dir, found2), 'utf8');
                } catch { /* nothing */ }
            }
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
            if (!text) {
                const hint = said.trim().split('\n').slice(-3).join(' ');
                return reject(new Error(code === 0
                    ? `${tool.id} finished but wrote no subtitles. Whisper said: ${hint}`
                    : `${tool.id} failed: ${hint}`));
            }
            resolve(text);
        });
    });
}

// ---------- routes (mounted at /api/asr) ----------

const router = express.Router();

// what Settings shows. The paths stay on this machine's side of the screen: the page gets ids.
router.get('/', (req, res) => {
    const s = status();
    res.json({
        ready: s.ready,
        // which of the three true things is the case, for the page to word in its own language
        code: !s.tools.length ? 'missing' : !s.ready ? 'model' : 'ready',
        tools: s.tools.map((t) => ({ id: t.id, family: t.family })),
        model: s.model ? path.basename(s.model) : null,
        help: s.help,
    });
});

// the one-click model download: whisper.cpp's base model, checked against its pinned sha256.
// OpenAI whisper and faster-whisper bring their own models, so this is whisper.cpp only.
router.post('/model', async (req, res) => {
    const s = status();
    if (!s.tools.length) return res.status(403).json({ error: 'no speech recognition tool is installed yet' });
    if (s.tools[0].family !== 'cpp') return res.status(403).json({ error: 'model download is for whisper.cpp; OpenAI whisper and faster-whisper bring their own models' });
    try {
        const model = await downloadModel();
        res.json({ ok: true, model: path.basename(model) });
    } catch (err) {
        console.error('asr model:', err.message);
        res.status(503).json({ error: err.message });
    }
});

// audio in (the file itself), SRT out. The same SRT the players already read (server/subtitles.js).
router.post('/transcribe', express.raw({ type: () => true, limit: '2gb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'the audio file is empty' });
    console.log(`asr: received ${req.body.length} bytes of audio for transcription`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-asr-in-'));
    const name = String(req.query.name || 'audio').replace(/[^\w.-]/g, '_').slice(-80) || 'audio';
    const file = path.join(dir, name);
    try {
        fs.writeFileSync(file, req.body);
        const srt = await transcribe(file, { lang: String(req.query.lang || 'ja') });
        res.json({ srt });
    } catch (err) {
        console.error('asr:', err.message);
        res.status(503).json({ error: err.message });
    } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
    }
});

module.exports = { status, transcribe, which, models, router, TOOLS, downloadModel };
