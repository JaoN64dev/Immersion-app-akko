// The local assistant (3.0, feature 20): a breakdown of a sentence, written by a language model that
// runs on this computer through Ollama (https://ollama.com) — free, offline, nothing sent anywhere.
// akko doesn't install it or ship a model: like Whisper, it finds what you installed. Without it the
// pages still show akko's own breakdown (words, readings, meanings, grammar lessons); this adds a
// written explanation on top.
//
//   GET  /api/assistant             -> {running, models: [names], url}
//   POST /api/assistant/explain     {sentence, lang, native, model, words, grammar}
//                                   -> the explanation as plain text, streamed as it is written
//
// AKKO_OLLAMA points at another Ollama (default http://127.0.0.1:11434).

const express = require('express');

const OLLAMA = (process.env.AKKO_OLLAMA || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const MAX_SENTENCE = 400;

// the language names the model is told to write in / about
const NAMES = {
    ja: 'Japanese', en: 'English', pt: 'Portuguese', es: 'Spanish', de: 'German', fr: 'French', it: 'Italian',
    ru: 'Russian', zh: 'Chinese', cmn: 'Mandarin Chinese', yue: 'Cantonese', ko: 'Korean', pl: 'Polish', ar: 'Arabic', th: 'Thai',
};
const nameOf = (tag, fallback) => NAMES[String(tag || '').toLowerCase()] || (tag ? String(tag) : fallback);

async function models() {
    const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(`Ollama answered ${res.status}`);
    const body = await res.json();
    return (body.models || []).map((m) => m.name).filter(Boolean);
}

// What the model is asked. akko's own analysis goes in too, so the model explains these words
// rather than guessing where one ends.
function prompt({ sentence, lang, native, words = [], grammar = [] }) {
    const learning = nameOf(lang, 'Japanese');
    const answerIn = nameOf(native, 'English');
    const system = [
        `You are a patient ${learning} teacher. A learner whose own language is ${answerIn} clicked a sentence and wants it explained.`,
        `Write in ${answerIn}. Keep ${learning} words in ${learning} script.`,
        'Answer in this order, with short headings:',
        '1. A natural translation of the whole sentence.',
        '2. The sentence word by word (or chunk by chunk): the form as written, its dictionary form and reading, what it means, and what any ending or particle adds.',
        '3. The grammar points, one short line each.',
        '4. One or two nuances a learner could miss (politeness, who is speaking, implied subjects), only if there are any.',
        'Be brief and concrete. Use only the words that are in the sentence. If you are not sure about something, say so.',
    ].join('\n');
    const hints = [];
    if (words.length) hints.push(`Words found by the app's dictionary: ${words.slice(0, 40).map((w) => (w.base && w.base !== w.surface ? `${w.surface} (${w.base})` : w.surface)).join(', ')}`);
    if (grammar.length) hints.push(`Grammar the app recognised: ${grammar.slice(0, 12).join('; ')}`);
    const user = `Sentence: ${sentence}${hints.length ? `\n\n${hints.join('\n')}` : ''}`;
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        res.json({ running: true, models: await models(), url: OLLAMA });
    } catch {
        res.json({ running: false, models: [], url: OLLAMA });
    }
});

router.post('/explain', express.json({ limit: '64kb' }), async (req, res) => {
    const b = req.body || {};
    const sentence = String(b.sentence || '').trim();
    if (!sentence) return res.status(400).json({ error: 'no sentence to explain' });
    if (sentence.length > MAX_SENTENCE) return res.status(400).json({ error: `that is too long to explain at once (${MAX_SENTENCE} characters at most)` });
    const clean = (list) => (Array.isArray(list) ? list : []).slice(0, 60);
    let installed;
    try { installed = await models(); } catch {
        return res.status(503).json({ code: 'missing', error: 'Ollama is not running on this computer: start it (or install it from ollama.com) for written explanations' });
    }
    const model = installed.includes(b.model) ? b.model : installed[0];
    if (!model) return res.status(503).json({ code: 'model', error: 'Ollama has no model yet: in a terminal, run  ollama pull qwen2.5:7b' });

    const stop = new AbortController();
    res.on('close', () => { if (!res.writableEnded) stop.abort(); });     // the dialog was closed: stop the model
    let upstream;
    try {
        upstream = await fetch(`${OLLAMA}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, stream: true, messages: prompt({ sentence, lang: b.lang, native: b.native, words: clean(b.words), grammar: clean(b.grammar).map(String) }), options: { temperature: 0.3 } }),
            signal: stop.signal,
        });
    } catch (err) {
        return res.status(503).json({ code: 'missing', error: `couldn't reach Ollama: ${err.message}` });
    }
    if (!upstream.ok) {
        const text = await upstream.text().catch(() => '');
        return res.status(502).json({ error: `Ollama: ${text.slice(0, 200) || upstream.status}` });
    }
    res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Akko-Model': encodeURIComponent(model) });
    // Ollama streams one JSON object per line: {message: {content}, done}
    let buffer = '';
    try {
        for await (const chunk of upstream.body) {
            buffer += Buffer.from(chunk).toString('utf8');
            let nl;
            while ((nl = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, nl).trim();
                buffer = buffer.slice(nl + 1);
                if (!line) continue;
                let msg;
                try { msg = JSON.parse(line); } catch { continue; }
                if (msg.error) { res.write(`\n\n(${msg.error})`); continue; }
                if (msg.message && msg.message.content) res.write(msg.message.content);
            }
        }
    } catch { /* the page went away, or Ollama stopped: what was written stays */ }
    res.end();
});

module.exports = { router, prompt, OLLAMA };
