// Colours in style.css come from the theme variables (:root, swapped by the dark theme at the end of
// the file). A literal colour in a new panel is a bug you only see at night: the first version of the
// plan box had #fbf7ec with the theme's light text on it, and it was unreadable.
const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');

// the body of the last rule for a selector (the 3.0 blocks are one rule each)
function rule(selector) {
    const re = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
    let last = null;
    let m;
    while ((m = re.exec(css))) last = m[2];
    return last;
}

test('the 3.0 panels take every colour from the theme, never from a literal', () => {
    const selectors = ['.library-plan', '.plan-time', '.reader-prime', '.reader-prime b', '.prime-word', '.prime-gain', '.welcome-other', '#learning-note', '.dict-pack .hint'];
    for (const sel of selectors) {
        const body = rule(sel);
        assert.ok(body, `${sel} is in style.css`);
        const literal = body.match(/#[0-9a-f]{3,8}\b|rgba?\(/i);
        assert.equal(literal, null, `${sel} uses a literal colour (${literal && literal[0]}): use var(--…) so the dark theme works`);
    }
});

test('the theme really does swap the colours those panels use', () => {
    for (const name of ['--post-bg', '--ink', '--ink-soft', '--table-highlight']) {
        const uses = css.split(`${name}:`).length - 1;
        assert.ok(uses >= 2, `${name} is defined for the light theme and redefined for the dark one`);
    }
    assert.match(css, /prefers-color-scheme: dark/, 'a dark theme exists');
});
