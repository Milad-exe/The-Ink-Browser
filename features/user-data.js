/**
 * Northstar — import / export of the user's own data
 *
 * Nobody can move to a browser they can't bring their bookmarks to, and nobody
 * should be stuck in one they can't get their passwords out of. Formats are the
 * ones every other browser reads and writes:
 *
 *   bookmarks — Netscape bookmark HTML (most browsers)
 *   passwords — CSV with a url/username/password header (most browsers and password managers)
 *   history   — CSV out only; no browser imports history, and pretending to
 *               parse every dialect would be worse than an honest omission
 *
 * The parsers are deliberately tolerant: real export files from five browsers
 * disagree about attribute order, quoting and column names, and a bookmark file
 * that fails to import is a user who stays where they are.
 *
 * SAFETY: an exported password file is plaintext by definition. The caller is
 * responsible for warning; this module refuses to write one anywhere except a
 * path the user picked in a save dialog.
 */
'use strict';
const fs = require('fs');
const log = require('./log');

// ── Netscape bookmark HTML ───────────────────────────────────────────────────
const escapeHtml = (s) => String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const unescapeHtml = (s) => String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

/**
 * Serialise a bookmark tree to Netscape HTML.
 * @param items [{ type: 'bookmark'|'folder', title, url, children }]
 */
function bookmarksToHtml(items) {
    const lines = [
        '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
        '<!-- This is an automatically generated file. It will be read and overwritten. -->',
        '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
        '<TITLE>Bookmarks</TITLE>',
        '<H1>Bookmarks</H1>',
        '<DL><p>',
    ];
    const walk = (list, depth) => {
        const pad = '    '.repeat(depth);
        for (const item of list || []) {
            if (item.type === 'folder') {
                lines.push(`${pad}<DT><H3>${escapeHtml(item.title || 'Folder')}</H3>`);
                lines.push(`${pad}<DL><p>`);
                walk(item.children, depth + 1);
                lines.push(`${pad}</DL><p>`);
            }
            else if (item.url) {
                const added = item.addedAt ? ` ADD_DATE="${Math.floor(item.addedAt / 1000)}"` : '';
                lines.push(`${pad}<DT><A HREF="${escapeHtml(item.url)}"${added}>${escapeHtml(item.title || item.url)}</A>`);
            }
        }
    };
    walk(items, 1);
    lines.push('</DL><p>');
    return lines.join('\n') + '\n';
}

/**
 * Parse Netscape bookmark HTML into a flat list of { title, url, folder }.
 * Flat, because ink's folder model is one level deep — nested source folders
 * collapse to their nearest named ancestor rather than being dropped.
 */
function parseBookmarksHtml(html) {
    const out = [];
    const stack = []; // folder titles, outermost first
    // One pass over the tags that matter. A real parser would be overkill: the
    // format is machine-written and shallow, but attribute order varies.
    const token = /<\s*(\/?)\s*(DL|H3|A)\b([^>]*)>([^<]*)/gi;
    let m;
    while ((m = token.exec(html)) !== null) {
        const closing = m[1] === '/';
        const tag = m[2].toUpperCase();
        const attrs = m[3] || '';
        const text = unescapeHtml((m[4] || '').trim());
        if (tag === 'H3' && !closing) {
            stack.push(text || 'Imported');
            continue;
        }
        if (tag === 'DL' && closing) {
            stack.pop();
            continue;
        }
        if (tag === 'A' && !closing) {
            const href = /href\s*=\s*"([^"]*)"/i.exec(attrs) || /href\s*=\s*'([^']*)'/i.exec(attrs);
            const url = href ? unescapeHtml(href[1]) : '';
            if (!/^https?:|^ftp:|^file:/i.test(url))
                continue; // skip javascript: bookmarklets and place: entries
            const added = /add_date\s*=\s*"(\d+)"/i.exec(attrs);
            out.push({
                title: text || url,
                url,
                folder: stack.length ? stack[stack.length - 1] : null,
                addedAt: added ? Number(added[1]) * 1000 : null,
            });
        }
    }
    return out;
}

// ── CSV ──────────────────────────────────────────────────────────────────────
/** RFC4180-ish parse: quoted fields, doubled quotes, CRLF or LF. */
function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    const src = String(text || '').replace(/^﻿/, ''); // strip BOM (Excel exports)
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (quoted) {
            if (c === '"') {
                if (src[i + 1] === '"') { field += '"'; i++; }
                else quoted = false;
            }
            else field += c;
            continue;
        }
        if (c === '"') { quoted = true; continue; }
        if (c === ',') { row.push(field); field = ''; continue; }
        if (c === '\r') continue;
        if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
        field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(cell => cell !== ''));
}

function toCsv(header, rows) {
    const cell = (v) => {
        const s = v == null ? '' : String(v);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [header.map(cell).join(','), ...rows.map(r => r.map(cell).join(','))].join('\n') + '\n';
}

/**
 * Parse a password CSV from any of the usual exporters. Column names differ
 * (`url`/`origin`/`website`, `username`/`login`…), so match by known aliases
 * rather than position.
 */
function parsePasswordCsv(text) {
    const rows = parseCsv(text);
    if (rows.length < 2)
        return [];
    const header = rows[0].map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));
    const findCol = (...names) => {
        for (const n of names) {
            const i = header.indexOf(n);
            if (i !== -1)
                return i;
        }
        return -1;
    };
    const urlCol = findCol('url', 'origin', 'website', 'login_uri', 'web site', 'hostname');
    const userCol = findCol('username', 'user', 'login', 'login_username', 'email', 'account');
    const passCol = findCol('password', 'login_password', 'pass');
    if (urlCol === -1 || passCol === -1)
        return [];
    const out = [];
    for (const row of rows.slice(1)) {
        const url = (row[urlCol] || '').trim();
        const password = row[passCol] || '';
        if (!url || !password)
            continue;
        let origin = url;
        try { origin = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).origin; }
        catch { continue; }
        out.push({ origin, username: (row[userCol] || '').trim(), password });
    }
    return out;
}

const passwordsToCsv = (records) => toCsv(
    ['url', 'username', 'password'],
    (records || []).map(r => [r.origin, r.username, r.password]),
);

const historyToCsv = (entries) => toCsv(
    ['url', 'title', 'visited_at'],
    (entries || []).map(e => [e.url, e.title || '', e.timestamp ? new Date(e.timestamp).toISOString() : '']),
);

// ── File helpers ─────────────────────────────────────────────────────────────
function readText(file) {
    return fs.readFileSync(file, 'utf-8');
}

function writeText(file, text) {
    fs.writeFileSync(file, text, 'utf-8');
    log.info('user-data', `wrote ${file.split('/').pop()}`);
}

module.exports = {
    bookmarksToHtml, parseBookmarksHtml,
    parseCsv, toCsv, parsePasswordCsv, passwordsToCsv, historyToCsv,
    readText, writeText,
};
