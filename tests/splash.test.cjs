// The splash: when it is shown, how long it stays, and what is in its page.
const assert = require('node:assert/strict')
const { shouldShowSplash, splashMinMs, splashHtml, SPLASH_TITLE, SPLASH_MIN_MS } = require('./.build/splashContent.cjs')

// ── when ──
assert.equal(shouldShowSplash({}, false), true, 'a normal start shows it')
assert.equal(shouldShowSplash({}, true), false, 'not while a debugger drives the app (tests, screenshots): it would be taken for the window')
assert.equal(shouldShowSplash({ ZIVAR_SPLASH: '1' }, true), true, 'unless it is asked for')
assert.equal(shouldShowSplash({ ZIVAR_SPLASH: '0' }, false), false, 'and it can be turned off')
assert.equal(shouldShowSplash({ ZIVAR_SPLASH: 'yes' }, false), true, 'anything else means the default')
console.log('when OK')

// ── how long ──
assert.equal(SPLASH_MIN_MS, 2000)
assert.equal(splashMinMs({}), 2000)
assert.equal(splashMinMs({ ZIVAR_SPLASH_MIN_MS: '5000' }), 5000)
assert.equal(splashMinMs({ ZIVAR_SPLASH_MIN_MS: '0' }), 0)
for (const bad of ['', '  ', 'abc', '-5', 'NaN']) assert.equal(splashMinMs({ ZIVAR_SPLASH_MIN_MS: bad }), 2000, `"${bad}" is ignored`)
console.log('how long OK')

// ── the page ──
const html = splashHtml('1.2.3')
assert.ok(html.includes(`<title>${SPLASH_TITLE}</title>`), 'the title tells it from the real window')
assert.match(html, /Zivar Database Studio<\/h1>/)
assert.match(html, /Version 1\.2\.3/)
assert.ok(!/<script/i.test(html), 'no scripts')
assert.ok(!/https?:\/\//i.test(html), 'no network, not even a namespace URL')
assert.ok(!/(src|href)=/i.test(html), 'no files to load')
assert.match(html, /Content-Security-Policy[^>]*default-src 'none'/, 'locked down')
for (const piece of ['@keyframes draw', '@keyframes pop', '@keyframes ring', '@keyframes slide', '@keyframes leave', 'body.leave', 'prefers-reduced-motion']) assert.ok(html.includes(piece), `has ${piece}`)
assert.equal((html.match(/class="node n[12]"/g) ?? []).length, 2, 'the two nodes of the logo')
assert.ok(splashHtml('<b>&"x').includes('Version &lt;b&gt;&amp;&quot;x'), 'the version is escaped')
assert.ok(!splashHtml('<img src=x onerror=alert(1)>').includes('<img'), 'no markup can get in through the version')
console.log('page OK')
console.log('ALL SPLASH TESTS PASSED')
