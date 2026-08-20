/**
 * Pure-logic unit tests — `npm run test:unit`. No Electron, no window: these
 * cover the parts that fail silently in a browser (a mis-parsed bookmark file,
 * a back/forward tree that loses an entry, a URL that should never have been
 * handed to the OS) and so are the parts worth pinning down.
 *
 * Modules that pull in `electron` are stubbed through require.cache, which is
 * why this file can run under plain node.
 */
'use strict';
const path = require('path');
const assert = require('assert');
const Module = require('module');

// ── Stub `electron` before anything requires it ──────────────────────────────
const electronStub = {
    app: {
        getPath: () => require('os').tmpdir(),
        getVersion: () => '1.0.0',
        setAsDefaultProtocolClient: () => true,
        isDefaultProtocolClient: () => false,
        on: () => { },
    },
    safeStorage: { isEncryptionAvailable: () => false },
    net: { request: () => { throw new Error('no network in unit tests'); } },
    shell: {},
    dialog: {},
};
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
    if (request === 'electron')
        return 'electron-stub';
    return realResolve.call(this, request, ...rest);
};
require.cache['electron-stub'] = { id: 'electron-stub', filename: 'electron-stub', loaded: true, exports: electronStub };

const root = path.join(__dirname, '..');
const userData = require(path.join(root, 'features/user-data'));
const NavigationHistory = require(path.join(root, 'features/navigation-history'));
const { sanitizeUrl, isSafeExternal } = require(path.join(root, 'features/url-security'));
const updates = require(path.join(root, 'features/updates'));
const searchEngines = require(path.join(root, 'features/search-engines'));
const defaultBrowser = require(path.join(root, 'features/default-browser'));
const chromeUtil = require(path.join(root, 'renderer/lib/util'));
const chromeI18n = require(path.join(root, 'renderer/lib/i18n'));
const i18n = require(path.join(root, 'features/i18n'));

// ── Tiny harness ─────────────────────────────────────────────────────────────
let passed = 0;
const failures = [];
function test(name, fn) {
    try {
        fn();
        passed++;
    }
    catch (err) {
        failures.push({ name, err });
    }
}

// ── Bookmarks: Netscape HTML ─────────────────────────────────────────────────
const CHROME_EXPORT = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1600000000" LAST_MODIFIED="1600000000" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://example.com/" ADD_DATE="1600000000">Example &amp; Co</A>
        <DT><H3>Work</H3>
        <DL><p>
            <DT><A HREF="https://jira.internal/browse/ABC-1">Ticket &lt;1&gt;</A>
        </DL><p>
        <DT><A HREF="javascript:void(0)">A bookmarklet</A>
    </DL><p>
    <DT><A HREF="https://news.example.org/">News</A>
</DL><p>`;

test('bookmark import reads a Chrome export', () => {
    const items = userData.parseBookmarksHtml(CHROME_EXPORT);
    const urls = items.map(i => i.url);
    assert.deepStrictEqual(urls, [
        'https://example.com/',
        'https://jira.internal/browse/ABC-1',
        'https://news.example.org/',
    ], 'javascript: bookmarklets must be skipped, real ones kept');
});

test('bookmark import unescapes entities in titles', () => {
    const items = userData.parseBookmarksHtml(CHROME_EXPORT);
    assert.strictEqual(items[0].title, 'Example & Co');
    assert.strictEqual(items[1].title, 'Ticket <1>');
});

test('bookmark import tracks the enclosing folder', () => {
    const items = userData.parseBookmarksHtml(CHROME_EXPORT);
    assert.strictEqual(items[0].folder, 'Bookmarks bar');
    assert.strictEqual(items[1].folder, 'Work');
    assert.strictEqual(items[2].folder, null, 'a top-level bookmark has no folder');
});

test('bookmark export round-trips through the importer', () => {
    const html = userData.bookmarksToHtml([
        { type: 'folder', title: 'Reading', children: [{ type: 'bookmark', url: 'https://a.example/x?y=1&z=2', title: 'A & B' }] },
        { type: 'bookmark', url: 'https://b.example/', title: 'B' },
    ]);
    const back = userData.parseBookmarksHtml(html);
    assert.strictEqual(back.length, 2);
    assert.strictEqual(back[0].url, 'https://a.example/x?y=1&z=2', 'ampersands survive the round trip');
    assert.strictEqual(back[0].title, 'A & B');
    assert.strictEqual(back[0].folder, 'Reading');
});

test('bookmark import survives a file with no bookmarks', () => {
    assert.deepStrictEqual(userData.parseBookmarksHtml('<html><body>nothing</body></html>'), []);
});

// ── Passwords: CSV ───────────────────────────────────────────────────────────
test('password import reads the Chrome column names', () => {
    const rows = userData.parsePasswordCsv('name,url,username,password\nExample,https://example.com/login,alice,hunter2\n');
    assert.deepStrictEqual(rows, [{ origin: 'https://example.com', username: 'alice', password: 'hunter2' }]);
});

test('password import reads Firefox/Bitwarden column names', () => {
    const rows = userData.parsePasswordCsv('login_uri,login_username,login_password\nexample.org,bob,s3cret\n');
    assert.deepStrictEqual(rows, [{ origin: 'https://example.org', username: 'bob', password: 's3cret' }]);
});

test('password import handles quoted fields, commas and doubled quotes', () => {
    const rows = userData.parsePasswordCsv('url,username,password\n"https://a.example","al,ice","pa""ss"\n');
    assert.strictEqual(rows[0].username, 'al,ice');
    assert.strictEqual(rows[0].password, 'pa"ss');
});

test('password import skips rows with no password', () => {
    const rows = userData.parsePasswordCsv('url,username,password\nhttps://a.example,alice,\nhttps://b.example,bob,x\n');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].origin, 'https://b.example');
});

test('password import returns nothing when the columns are missing', () => {
    assert.deepStrictEqual(userData.parsePasswordCsv('foo,bar\n1,2\n'), []);
});

test('password export quotes what needs quoting', () => {
    const csv = userData.passwordsToCsv([{ origin: 'https://a.example', username: 'a,b', password: 'q"q' }]);
    assert.strictEqual(csv, 'url,username,password\nhttps://a.example,"a,b","q""q"\n');
});

test('CSV parser strips a BOM', () => {
    const rows = userData.parseCsv('﻿url,username,password\nhttps://a.example,a,b\n');
    assert.strictEqual(rows[0][0], 'url');
});

// ── Navigation history (back/forward tree) ───────────────────────────────────
test('restoring a tab rebuilds a walkable back/forward tree', () => {
    const nav = new NavigationHistory();
    nav.restoreTab(7, [
        { url: 'https://a.example', title: 'A' },
        { url: 'https://b.example', title: 'B' },
        { url: 'https://c.example', title: 'C' },
    ], 2);
    assert.strictEqual(nav.getCurrentUrl(7), 'https://c.example');
    assert.strictEqual(nav.canGoBack(7), true);
    assert.strictEqual(nav.canGoForward(7), false);
    assert.strictEqual(nav.goBack(7), 'https://b.example');
    assert.strictEqual(nav.goBack(7), 'https://a.example');
    assert.strictEqual(nav.goBack(7), null, 'the oldest entry has nothing behind it');
    assert.strictEqual(nav.goForward(7), 'https://b.example');
});

test('restore clamps an out-of-range current index', () => {
    const nav = new NavigationHistory();
    nav.restoreTab(1, ['https://a.example', 'https://b.example'], 99);
    assert.strictEqual(nav.getCurrentUrl(1), 'https://b.example');
});

test('restore keeps entry titles for the history dropdown', () => {
    const nav = new NavigationHistory();
    nav.restoreTab(2, [{ url: 'https://a.example', title: 'Alpha' }, { url: 'https://b.example', title: 'Beta' }], 1);
    const titles = nav.getHistory(2).entries.map(e => e.title);
    assert.deepStrictEqual(titles, ['Alpha', 'Beta']);
});

test('a new entry after going back truncates the forward branch', () => {
    const nav = new NavigationHistory();
    nav.restoreTab(3, ['https://a.example', 'https://b.example', 'https://c.example'], 2);
    nav.goBack(3);
    nav.addEntry(3, 'https://d.example');
    assert.strictEqual(nav.canGoForward(3), false);
    assert.strictEqual(nav.getCurrentUrl(3), 'https://d.example');
});

// ── URL safety ───────────────────────────────────────────────────────────────
test('sanitizeUrl refuses javascript: and data: urls', () => {
    assert.notStrictEqual(sanitizeUrl('javascript:alert(1)'), 'javascript:alert(1)');
    assert.notStrictEqual(sanitizeUrl('data:text/html,<script>x</script>'), 'data:text/html,<script>x</script>');
});

test('sanitizeUrl keeps ordinary web urls intact', () => {
    assert.strictEqual(sanitizeUrl('https://example.com/a?b=1#c'), 'https://example.com/a?b=1#c');
});

test('only http(s) may be handed to the OS', () => {
    assert.strictEqual(isSafeExternal('https://example.com'), true);
    assert.strictEqual(isSafeExternal('file:///etc/passwd'), false);
    assert.strictEqual(isSafeExternal('javascript:alert(1)'), false);
});

// ── Update version comparison ────────────────────────────────────────────────
test('version comparison orders releases correctly', () => {
    assert.strictEqual(updates.compareVersions('1.2.3', '1.2.2'), 1);
    assert.strictEqual(updates.compareVersions('1.2.3', '1.3.0'), -1);
    assert.strictEqual(updates.compareVersions('2.0.0', '1.99.99'), 1);
    assert.strictEqual(updates.compareVersions('1.0.0', '1.0.0'), 0);
});

test('version comparison tolerates tags and pre-release suffixes', () => {
    assert.strictEqual(updates.compareVersions('v1.4.0', '1.3.9'), 1);
    assert.strictEqual(updates.compareVersions('1.4.0-beta.2', '1.4.0'), 0);
    assert.strictEqual(updates.compareVersions('garbage', '1.0.0'), 0, 'unparseable means "do not claim an update"');
});

// ── Search engines ───────────────────────────────────────────────────────────
const fakePersistence = (initial = []) => {
    let stored = initial;
    return { get: () => stored, set: (_k, v) => { stored = v; } };
};

test('a bare query goes to the default engine', () => {
    searchEngines.init(fakePersistence());
    const r = searchEngines.resolve('electron docs', 'duckduckgo');
    assert.strictEqual(r.url, 'https://duckduckgo.com/?q=electron%20docs');
    assert.strictEqual(r.viaKeyword, false);
});

test('a keyword prefix routes to that engine for one search', () => {
    searchEngines.init(fakePersistence());
    const r = searchEngines.resolve('b electron docs', 'google');
    assert.strictEqual(r.engine.id, 'bing');
    assert.strictEqual(r.query, 'electron docs');
    assert.strictEqual(r.viaKeyword, true);
});

test('a bare keyword with no query is just a search for that word', () => {
    searchEngines.init(fakePersistence());
    const r = searchEngines.resolve('b', 'google');
    assert.strictEqual(r.engine.id, 'google');
    assert.strictEqual(r.query, 'b');
});

test('custom engines can be added, used by keyword, and removed', () => {
    const store = fakePersistence();
    searchEngines.init(store);
    const saved = searchEngines.upsert({ name: 'Wiki', keyword: 'w', url: 'https://en.wikipedia.org/w/index.php?search=%s' });
    assert.ok(searchEngines.all().some(e => e.id === saved.id));
    const r = searchEngines.resolve('w electron', 'google');
    assert.strictEqual(r.engine.name, 'Wiki');
    assert.strictEqual(r.url, 'https://en.wikipedia.org/w/index.php?search=electron');
    assert.strictEqual(searchEngines.remove(saved.id), true);
    assert.strictEqual(searchEngines.all().some(e => e.id === saved.id), false);
});

test('an engine without %s is rejected', () => {
    searchEngines.init(fakePersistence());
    assert.throws(() => searchEngines.upsert({ name: 'Bad', url: 'https://example.com/search' }));
});

test('a custom engine cannot hijack a built-in id', () => {
    searchEngines.init(fakePersistence());
    const saved = searchEngines.upsert({ id: 'google', name: 'Not Google', url: 'https://evil.example/?q=%s' });
    assert.notStrictEqual(saved.id, 'google');
    assert.strictEqual(searchEngines.byId('google').name, 'Google');
});

test('query encoding survives characters that would break a URL', () => {
    searchEngines.init(fakePersistence());
    const r = searchEngines.resolve('a&b=c #d', 'google');
    assert.strictEqual(r.url, 'https://www.google.com/search?q=a%26b%3Dc%20%23d');
});

// ── Default browser: incoming link argv ──────────────────────────────────────
test('an incoming link is picked out of argv', () => {
    assert.strictEqual(defaultBrowser.firstUrlIn(['/path/app', '--flag', 'https://example.com/x']), 'https://example.com/x');
    assert.strictEqual(defaultBrowser.firstUrlIn(['/path/app', '--flag']), null);
    assert.strictEqual(defaultBrowser.firstUrlIn([]), null);
});

// ── Omnibox helpers (renderer/lib/util.js) ───────────────────────────────────
test('typed text is classified as a URL or a search', () => {
    for (const url of ['https://example.com', 'example.com', 'example.co.uk/path', 'localhost:3000', 'sub.domain.io'])
        assert.strictEqual(chromeUtil.looksLikeUrl(url), true, `${url} should look like a URL`);
    for (const query of ['how to tie a tie', 'electron', 'why is the sky blue', 'a.b c'])
        assert.strictEqual(chromeUtil.looksLikeUrl(query), false, `${query} should look like a search`);
});

test('dedup key ignores www, scheme and a trailing slash', () => {
    const a = chromeUtil.normalizeUrl('https://www.example.com/path/');
    assert.strictEqual(a, chromeUtil.normalizeUrl('http://example.com/path'));
});

test('suggestion ranking prefers host matches over title matches', () => {
    const host = { url: 'https://youtube.com/', title: 'Nothing relevant' };
    const title = { url: 'https://other.example/x', title: 'You Tube fan page' };
    assert.ok(chromeUtil.linkScore(host, 'you') < chromeUtil.linkScore(title, 'you'));
});

test('a one-letter query does not match by substring', () => {
    assert.strictEqual(chromeUtil.linkScore({ url: 'https://gymshark.com/', title: 'Gymshark' }, 'y'), -1);
    assert.strictEqual(chromeUtil.linkScore({ url: 'https://youtube.com/', title: 'YouTube' }, 'y'), 0);
});

test('weak matches on login redirects and giant URLs are dropped', () => {
    assert.strictEqual(chromeUtil.isLowValueMatch('https://accounts.example.com/signin?continue=x', 2), true);
    assert.strictEqual(chromeUtil.isLowValueMatch('https://example.com/' + 'a'.repeat(120), 2), true);
    assert.strictEqual(chromeUtil.isLowValueMatch('https://accounts.example.com/signin', 0), false, 'a strong host match is always kept');
});

test('cleanliness sorts short titled URLs ahead of long untitled ones', () => {
    const titled = { url: 'https://a.example/x', title: 'A page' };
    const untitled = { url: 'https://a.example/x', title: 'https://a.example/x' };
    assert.ok(chromeUtil.cleanliness(titled) < chromeUtil.cleanliness(untitled));
});

test('resting URL display splits scheme, host and path', () => {
    assert.deepStrictEqual(chromeUtil.urlDisplayParts('https://example.com/a?b=1'), ['https://', 'example.com', '/a?b=1']);
    assert.strictEqual(chromeUtil.urlDisplayParts('file:///tmp/x'), null);
    assert.deepStrictEqual(chromeUtil.urlDisplayParts('https://user:pw@example.com/x'), ['https://user:pw@', 'example.com', '/x']);
});

test('omnibox and main process agree on keyword search', () => {
    const engines = [
        { id: 'google', keyword: 'g', url: 'https://www.google.com/search?q=%s' },
        { id: 'wiki', keyword: 'w', url: 'https://en.wikipedia.org/w/index.php?search=%s' },
    ];
    assert.strictEqual(chromeUtil.searchUrl('w electron', engines, 'google'), 'https://en.wikipedia.org/w/index.php?search=electron');
    assert.strictEqual(chromeUtil.searchUrl('electron', engines, 'google'), 'https://www.google.com/search?q=electron');
    assert.strictEqual(chromeUtil.keywordEngine('w', engines), null, 'a bare keyword is a search for that word');
});

test('debounce fires once and can be cancelled', async () => {
    let calls = 0;
    const fn = chromeUtil.debounce(() => calls++, 5);
    fn(); fn(); fn();
    await new Promise(r => setTimeout(r, 25));
    assert.strictEqual(calls, 1);
    fn();
    fn.cancel();
    await new Promise(r => setTimeout(r, 25));
    assert.strictEqual(calls, 1);
});

// ── Localisation ─────────────────────────────────────────────────────────────
test('every English string has a Spanish counterpart', () => {
    const en = require(path.join(root, 'locales/en.json')).strings;
    const es = require(path.join(root, 'locales/es.json')).strings;
    const missing = Object.keys(en).filter(k => !(k in es));
    assert.deepStrictEqual(missing, [], 'untranslated keys fall back to English, but the shipped locale should be complete');
    const extra = Object.keys(es).filter(k => !(k in en));
    assert.deepStrictEqual(extra, [], 'a Spanish key with no English source is a typo');
});

test('placeholders survive translation', () => {
    const en = require(path.join(root, 'locales/en.json')).strings;
    const es = require(path.join(root, 'locales/es.json')).strings;
    for (const [key, value] of Object.entries(en)) {
        const holes = (value.match(/\{\w+\}/g) || []).sort();
        const theirs = ((es[key] || '').match(/\{\w+\}/g) || []).sort();
        assert.deepStrictEqual(theirs, holes, `${key} must keep the same placeholders`);
    }
});

test('a missing key renders as the key, never as blank', () => {
    chromeI18n.init({ catalogue: { 'a.b': 'Hello' }, locale: 'en' });
    assert.strictEqual(chromeI18n.t('a.b'), 'Hello');
    assert.strictEqual(chromeI18n.t('nope.missing'), 'nope.missing');
});

test('translation fills placeholders', () => {
    chromeI18n.init({ catalogue: { 'greet': 'Continue to {host} anyway' }, locale: 'en' });
    assert.strictEqual(chromeI18n.t('greet', { host: 'example.com' }), 'Continue to example.com anyway');
});

test('the clock follows the locale rather than a fixed 24-hour format', () => {
    const at = new Date('2026-08-17T15:04:00');
    chromeI18n.init({ catalogue: {}, locale: 'en-US' });
    const us = chromeI18n.time(at);
    chromeI18n.init({ catalogue: {}, locale: 'de-DE' });
    const de = chromeI18n.time(at);
    assert.ok(/PM/i.test(us), `expected a 12-hour clock in en-US, got ${us}`);
    assert.ok(!/PM/i.test(de) && de.includes('15'), `expected a 24-hour clock in de-DE, got ${de}`);
});

test('file sizes use the locale decimal separator', () => {
    chromeI18n.init({ catalogue: {}, locale: 'en-US' });
    assert.strictEqual(chromeI18n.bytes(1536000), '1.5 MB');
    chromeI18n.init({ catalogue: {}, locale: 'es-ES' });
    assert.strictEqual(chromeI18n.bytes(1536000), '1,5 MB');
    chromeI18n.init({ catalogue: {}, locale: 'en-US' });
    assert.strictEqual(chromeI18n.bytes(512), '512 B', 'bytes stay whole');
});

test('locale resolution falls back from a region to its language, then English', () => {
    assert.strictEqual(i18n.resolve('es-419'), 'es');
    assert.strictEqual(i18n.resolve('es'), 'es');
    assert.strictEqual(i18n.resolve('sv-SE'), 'en', 'no catalogue → English, not a blank UI');
});

// ── Overlay placement ────────────────────────────────────────────────────────
// Panels used to invent their own geometry (six widths, four gaps, two
// hardcoded y values). These pin the one rule they all follow now.
const { panelBounds, CARD_TOP, SHELL_PAD } = require(path.join(root, 'features/overlay-bounds'));
const fakeWin = (width = 1440, height = 900) => ({ getContentBounds: () => ({ x: 0, y: 0, width, height }) });

test('a panel from the toolbar opens in the page card\'s top-right corner', () => {
    const b = panelBounds(fakeWin(), { anchor: { left: 1274, right: 1304, top: 13, bottom: 43 }, width: 320, height: 177 });
    assert.strictEqual(b.y, CARD_TOP, 'level with the top of the page card');
    assert.strictEqual(b.x + b.width, 1440 - SHELL_PAD, 'flush with the shell gutter');
});

test('toolbar panels share an edge whichever icon opened them', () => {
    const mk = (right) => panelBounds(fakeWin(), { anchor: { left: right - 30, right, top: 13, bottom: 43 }, width: 320, height: 177 });
    assert.strictEqual(mk(1304).x, mk(1432).x, 'the icons are one cluster, not three anchors');
});

test('a panel triggered low in the window opens upwards instead of being squashed', () => {
    const b = panelBounds(fakeWin(), { anchor: { left: 9, right: 39, top: 862, bottom: 892 }, width: 320, height: 177 });
    assert.strictEqual(b.height, 177, 'keeps its full height');
    assert.ok(b.y + b.height <= 892, 'sits above the trigger');
});

test('a panel anchored to the address field hangs from it, not from the corner', () => {
    const b = panelBounds(fakeWin(), { anchor: { left: 535, right: 557, top: 17, bottom: 39 }, align: 'left', width: 320, height: 300 });
    assert.strictEqual(b.x, 535);
    assert.strictEqual(b.y, CARD_TOP);
});

test('a panel taller than the window stops at the bottom gutter', () => {
    const b = panelBounds(fakeWin(), { anchor: { left: 1274, right: 1304, top: 13, bottom: 43 }, width: 320, height: 1200 });
    assert.strictEqual(b.y + b.height, 900 - SHELL_PAD);
});

// ── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
    console.error(`\n${failures.length} of ${passed + failures.length} unit tests failed:\n`);
    for (const { name, err } of failures)
        console.error(`  ✗ ${name}\n    ${err.message.split('\n')[0]}`);
    console.error('');
    process.exit(1);
}
console.log(`✓ ${passed} unit tests passed`);
