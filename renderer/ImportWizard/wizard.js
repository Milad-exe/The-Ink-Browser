'use strict';
// Import wizard renderer. Talks to the main process through window.nsImport
// (see preload/import-preload.js).

// Faithful brand logos (viewBox 0 0 48 48), inline so they always render. The
// Chrome/Chromium pinwheel geometry is exact (three 120° sectors round a hub).
const LOGOS = {
    chrome: '<circle cx="24" cy="24" r="22" fill="#fff"/><path fill="#EA4335" d="M4.95 13A22 22 0 0 1 43.05 13L31.79 19.5A9 9 0 0 0 16.21 19.5Z"/><path fill="#34A853" d="M24 46A22 22 0 0 1 4.95 13L16.21 19.5A9 9 0 0 0 24 33Z"/><path fill="#FBBC05" d="M43.05 13A22 22 0 0 1 24 46L24 33A9 9 0 0 0 31.79 19.5Z"/><circle cx="24" cy="24" r="9" fill="#fff"/><circle cx="24" cy="24" r="7" fill="#1a73e8"/>',
    chromium: '<circle cx="24" cy="24" r="22" fill="#fff"/><path fill="#5a7fc4" d="M4.95 13A22 22 0 0 1 43.05 13L31.79 19.5A9 9 0 0 0 16.21 19.5Z"/><path fill="#6aa06a" d="M24 46A22 22 0 0 1 4.95 13L16.21 19.5A9 9 0 0 0 24 33Z"/><path fill="#9fb0c9" d="M43.05 13A22 22 0 0 1 24 46L24 33A9 9 0 0 0 31.79 19.5Z"/><circle cx="24" cy="24" r="9" fill="#fff"/><circle cx="24" cy="24" r="7" fill="#6b9ceb"/>',
    firefox: '<circle cx="24" cy="24" r="22" fill="#fff"/><path fill="#ff9500" d="M40 20c1 3 1.5 6 1 9-1.6 9.5-10.6 15.4-19.8 13.6C11.8 40.8 6 32 7.4 23.1c.5-3 1.8-5.4 3-7.1-.4 2 0 4.2 1.3 5.8C13 15.2 17 11 22.3 9.6c-1.6 2.2-2 5.2-.9 7.8C22.7 11.8 27 7.6 32.6 6.4c-1.8 1.7-2.6 4.5-1.9 6.9 2-2.6 5.4-4 8.7-3.2-2.3.6-4.2 2.5-4.9 4.8 2.2-.8 4.7-.2 6.4 1.3z"/><path fill="#ff5000" d="M40 22c.6 2.4.6 5-.2 7.4-2.4 7.2-9.8 11.4-16.8 9.6C16 37.2 11.8 30 13.6 23.2c.6-2.2 1.8-4 3.2-5.2-.3 3.6 2.2 7 5.9 7.7 3.5.7 6.9-1.3 8-4.6 1.4.4 2.6 1.3 3.5 2.4.7-1.3 1.9-2 3.3-1.9-.1.1 1.8.9 2.5 1.4z"/>',
    edge: '<circle cx="24" cy="24" r="22" fill="#fff"/><path fill="#0c8484" d="M8 26C8 15.5 16.4 9 24.6 9.8c5.9.6 9.4 4.2 9.4 7.9 0 3-2.2 5-5.3 5-4 0-5.7-2.6-9.7-2.6-5.2 0-9 4.3-9 8.8 0 .4 0 .8.1 1.2A11 11 0 0 1 8 26z"/><path fill="#2b88d8" d="M19 20c4 0 5.7 2.6 9.7 2.6 1 0 1.9-.2 2.7-.6-1.3 8-8 12-13.7 12-3.6 0-6.6-1.4-8.6-4.3-.7-1.4-1.1-3-1.1-4.7 0-4.5 3.8-8.8 9-8.8.7 0 1.4.3 2 .8z"/><path fill="#50e6ff" d="M31.4 22c3.4-.3 6.6.9 8.2 3.4 1.8 3.8-.4 12-9.6 15.4 3.3-2.6 5.4-6.7 5.4-11.2 0-2.9-1.6-6.2-4-7.6z"/>',
    brave: '<path fill="#fb542b" d="M24 3l5 3h6l2 5-2 3 2 7c0 8-6 13-13 17-7-4-13-9-13-17l2-7-2-3 2-5h6z"/><path fill="#fff" opacity=".9" d="M24 9l3 4h5l-1 6 2 3-9 8-9-8 2-3-1-6h5z"/>',
    safari: '<circle cx="24" cy="24" r="22" fill="#f2f2f5"/><circle cx="24" cy="24" r="18" fill="#1a86e0"/><path fill="#fff" d="M32 16 22 22l-6 10 10-6z"/><path fill="#ff3b30" opacity=".9" d="M32 16 26 26l-4 4 4-14z"/>',
    opera: '<circle cx="24" cy="24" r="22" fill="#ff1b2d"/><ellipse cx="24" cy="24" rx="8.5" ry="12" fill="none" stroke="#fff" stroke-width="6"/>',
    operagx: '<circle cx="24" cy="24" r="22" fill="#1a1a1a"/><ellipse cx="24" cy="24" rx="8.5" ry="12" fill="none" stroke="#eb0029" stroke-width="6"/>',
    vivaldi: '<rect x="2" y="2" width="44" height="44" rx="12" fill="#ef3939"/><path fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" d="M15 16l9 16 9-16"/>',
    globe: '<circle cx="24" cy="24" r="22" fill="#6b7280"/><circle cx="24" cy="24" r="13" fill="none" stroke="#fff" stroke-width="2"/><path d="M11 24h26M24 11c5 4 5 22 0 26M24 11c-5 4-5 22 0 26" fill="none" stroke="#fff" stroke-width="1.6"/>',
};
const BADGES = [
    [/edge/i, LOGOS.edge],
    [/chromium/i, LOGOS.chromium],
    [/chrome/i, LOGOS.chrome],
    [/firefox/i, LOGOS.firefox],
    [/brave/i, LOGOS.brave],
    [/vivaldi/i, LOGOS.vivaldi],
    [/opera gx/i, LOGOS.operagx],
    [/opera/i, LOGOS.opera],
    [/safari/i, LOGOS.safari],
];
function badge(browser) {
    for (const [re, svg] of BADGES) if (re.test(browser)) return svg;
    return LOGOS.globe;
}

const $ = (id) => document.getElementById(id);
let sources = [];
let selected = null;

function summaryLine(s) {
    const parts = [];
    if (s.bookmarks) parts.push(`${s.bookmarks} bookmark${s.bookmarks === 1 ? '' : 's'}`);
    if (s.history) parts.push('History');
    if (s.engines) parts.push('Search engines');
    if (s.passwords) parts.push('Passwords');
    return parts.join(' · ') || 'No data found';
}

function renderSources() {
    const list = $('src-list');
    list.innerHTML = '';
    for (const s of sources) {
        const logo = badge(s.browser);
        const row = document.createElement('button');
        row.className = 'src-row';
        row.type = 'button';
        row.setAttribute('role', 'radio');
        row.dataset.id = s.id;
        row.innerHTML = `
            <span class="src-badge"><svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true">${logo}</svg></span>
            <span class="src-main">
                <span class="src-name">${escapeHtml(s.browser)}<span class="src-profile"> · ${escapeHtml(s.profile)}</span></span>
                <span class="src-meta">${escapeHtml(summaryLine(s))}</span>
            </span>
            <span class="src-check"></span>`;
        row.addEventListener('click', () => selectSource(s.id));
        list.appendChild(row);
    }
}

function selectSource(id) {
    selected = sources.find(s => s.id === id) || null;
    for (const row of document.querySelectorAll('.src-row')) {
        const on = row.dataset.id === id;
        row.classList.toggle('sel', on);
        row.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    const types = $('types');
    if (!selected) { types.hidden = true; return; }
    types.hidden = false;
    setType('bm', 'row-bm', 'm-bm', selected.bookmarks > 0, selected.bookmarks ? String(selected.bookmarks) : 'none');
    setType('hist', 'row-hist', 'm-hist', !!selected.history, selected.history ? '' : 'none');
    setType('eng', 'row-eng', 'm-eng', !!selected.engines, selected.engines ? '' : 'none');
    // Passwords: available only if the source has a store; still routed via CSV.
    setType('pw', 'row-pw', null, !!selected.passwords, null, /*defaultCheck*/ false);
    updateImportEnabled();
}

function setType(key, rowId, metaId, available, meta, defaultCheck = true) {
    const row = $(rowId);
    const box = $('t-' + key);
    row.classList.toggle('disabled', !available);
    box.disabled = !available;
    box.checked = available && defaultCheck;
    if (metaId && meta !== null) $(metaId).textContent = meta;
}

function updateImportEnabled() {
    const any = ['t-bm', 't-hist', 't-eng', 't-pw'].some(id => { const b = $(id); return b && !b.disabled && b.checked; });
    $('btn-import').disabled = !(selected && any);
}

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
function toast(msg, hold = 2600) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    if (hold) toastTimer = setTimeout(() => { t.hidden = true; }, hold);
}

async function doImport() {
    if (!selected) return;
    const types = [];
    if (!$('t-bm').disabled && $('t-bm').checked) types.push('bookmarks');
    if (!$('t-hist').disabled && $('t-hist').checked) types.push('history');
    if (!$('t-eng').disabled && $('t-eng').checked) types.push('engines');
    const wantPw = !$('t-pw').disabled && $('t-pw').checked;
    if (!types.length && !wantPw) return;

    const btn = $('btn-import');
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Importing…';
    const parts = [];
    let failed = false;
    try {
        if (types.length) {
            const res = await window.nsImport.run(selected.id, types);
            if (res && res.ok) {
                if (typeof res.bookmarks === 'number') parts.push(`${res.bookmarks} bookmark${res.bookmarks === 1 ? '' : 's'}`);
                if (typeof res.history === 'number') parts.push(`${res.history} history ${res.history === 1 ? 'entry' : 'entries'}`);
                if (typeof res.engines === 'number' && res.engines) parts.push(`${res.engines} search engine${res.engines === 1 ? '' : 's'}`);
            }
            else failed = true;
        }
        if (wantPw) {
            const pw = await window.nsImport.passwordsCsv();
            if (pw && pw.ok && typeof pw.added === 'number') parts.push(`${pw.added} password${pw.added === 1 ? '' : 's'}`);
            else if (pw && pw.error) toast(pw.error, 4000);
        }
    }
    catch (e) { failed = true; }

    btn.textContent = label;
    btn.disabled = false;
    updateImportEnabled();

    if (failed && !parts.length) { toast('Import failed — could not read that browser.', 4000); return; }
    if (!parts.length) { toast('Nothing new to import.'); return; }
    toast(`Imported ${parts.join(', ')} from ${selected.browser}.`, 3200);
    setTimeout(() => window.nsImport.close(), 1500);
}

function wire() {
    $('btn-close').addEventListener('click', () => window.nsImport.close());
    $('btn-cancel').addEventListener('click', () => window.nsImport.close());
    $('btn-import').addEventListener('click', doImport);
    for (const id of ['t-bm', 't-hist', 't-eng', 't-pw']) $(id).addEventListener('change', updateImportEnabled);
    $('btn-html').addEventListener('click', async () => {
        const res = await window.nsImport.html();
        if (res && res.ok) toast(`Imported ${res.bookmarks} bookmark${res.bookmarks === 1 ? '' : 's'} from the file.`, 3200);
        else if (res && !res.canceled) toast('Could not read that file.', 4000);
    });
}

async function init() {
    wire();
    try { sources = await window.nsImport.sources(); }
    catch (e) { sources = []; }
    $('loading').hidden = true;
    if (!sources.length) { $('src-empty').hidden = false; return; }
    renderSources();
    selectSource(sources[0].id); // preselect the first (default) browser
}

document.addEventListener('DOMContentLoaded', init);
