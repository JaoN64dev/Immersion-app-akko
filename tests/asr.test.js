// Local speech recognition (server/asr.js): akko looks for a Whisper-class tool on this machine and
// runs it — no service, no upload. The tool here is a small shell script that writes an SRT, which is
// exactly the contract: a command in, an SRT out.
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.AKKO_OFFLINE = '1';
process.env.AKKO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-asr-test-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const asr = require('../server/asr');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-asr-tool-'));
const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'akko-asr-empty-'));   // a PATH with no whisper in it
const posix = process.platform !== 'win32';
let fakeTool;

const saved = { AKKO_WHISPER: process.env.AKKO_WHISPER, AKKO_WHISPER_MODEL: process.env.AKKO_WHISPER_MODEL, PATH: process.env.PATH };

before(() => {
    if (!posix) return;
    fakeTool = path.join(dir, 'whisper-cli');
    // whisper.cpp's shape: -m model -f audio -osrt -of base -l lang  →  base.srt
    fs.writeFileSync(fakeTool, `#!/bin/sh
base=""
while [ $# -gt 0 ]; do
  case "$1" in
    -of) base="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf '1\\n00:00:00,000 --> 00:00:02,000\\nこんにちは\\n\\n2\\n00:00:02,500 --> 00:00:05,000\\n元気ですか\\n\\n' > "$base.srt"
`);
    fs.chmodSync(fakeTool, 0o755);
    fs.writeFileSync(path.join(dir, 'ggml-base.bin'), 'not really a model');
    process.env.AKKO_WHISPER_MODEL = path.join(dir, 'ggml-base.bin');
});

after(() => {
    for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(empty, { recursive: true, force: true });
    fs.rmSync(process.env.AKKO_DATA, { recursive: true, force: true });
});

test('with no tool on this machine, akko says what to install instead of pretending', { skip: !posix }, () => {
    process.env.AKKO_WHISPER = '';
    process.env.PATH = empty;                     // a PATH with no whisper in it
    const s = asr.status();
    assert.equal(s.tools.length, 0);
    assert.equal(s.ready, false);
    assert.match(s.help, /no speech recognition found/);
    assert.match(s.help, /nothing is uploaded/);
});

test('a tool that is there is found, and is not ready without a model', { skip: !posix }, () => {
    process.env.PATH = `${dir}${path.delimiter}${saved.PATH}`;
    process.env.AKKO_WHISPER = '';
    const withModel = asr.status();
    assert.equal(withModel.tools[0].id, 'whisper-cli');
    assert.equal(withModel.ready, true);
    const model = process.env.AKKO_WHISPER_MODEL;
    delete process.env.AKKO_WHISPER_MODEL;
    process.env.HOME = path.join(dir, 'no-models-here');          // ~/.cache has nothing in it
    const without = asr.status();
    assert.equal(without.ready, false, 'whisper.cpp needs a model file');
    assert.match(without.help, /needs a model/);
    process.env.AKKO_WHISPER_MODEL = model;
    process.env.HOME = saved.HOME || os.homedir();
});

test('the machine transcribes an audio file into an SRT akko can read', { skip: !posix }, async () => {
    process.env.PATH = `${dir}${path.delimiter}${saved.PATH}`;
    process.env.AKKO_WHISPER = fakeTool;
    process.env.AKKO_WHISPER_MODEL = path.join(dir, 'ggml-base.bin');
    const audio = path.join(dir, 'episode.mp3');
    fs.writeFileSync(audio, 'pretend audio');
    const srt = await asr.transcribe(audio, { lang: 'ja' });
    assert.match(srt, /こんにちは/);
    assert.match(srt, /00:00:02,500 --> 00:00:05,000/, 'timings come through with the text');
});

test('a tool that writes nothing is an error with the tool in it, not a silent empty subtitle', { skip: !posix }, async () => {
    const useless = path.join(dir, 'useless-whisper');
    fs.writeFileSync(useless, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(useless, 0o755);
    process.env.AKKO_WHISPER = useless;
    process.env.AKKO_WHISPER_MODEL = path.join(dir, 'ggml-base.bin');
    const audio = path.join(dir, 'silent.mp3');
    fs.writeFileSync(audio, 'pretend audio');
    await assert.rejects(() => asr.transcribe(audio), /finished but wrote no subtitles/);
});

// The instructions, in the app: Settings → speech recognition has the how-to open by itself when
// there is nothing to use. The text names real commands and the folder the server really reads.
test('Settings says how to install it, and names the folder the server looks in', () => {
    const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const html = read('settings.html');
    assert.match(html, /data-i18n="asr-howto"/, 'the block is translatable as a whole');
    assert.match(html, /<summary>how to install it<\/summary>/);
    assert.match(html, /brew install whisper-cpp/, 'macOS');
    assert.match(html, /whisper-bin-x64\.zip/, 'Windows');
    assert.match(html, /ggml-base\.bin/, 'the model it needs');
    assert.match(html, /AKKO_WHISPER_MODEL/, 'the escape hatch');
    // the folder in the text is the one server/asr.js reads
    assert.match(read('server/asr.js'), /'\.cache', 'akko', 'whisper'/);
    assert.match(html, /\.cache\/akko\/whisper/);
    // and the three complete tables carry it
    for (const tag of ['ja', 'pt', 'es']) {
        const table = read(`scripts/lang/${tag}.js`);
        assert.ok(table.includes('"asr-howto"'), `${tag}: the block`);
        assert.ok(table.includes('"how to install it"'), `${tag}: the label`);
        assert.ok(table.includes('AKKO_WHISPER_MODEL'), `${tag}: the escape hatch`);
    }
});
