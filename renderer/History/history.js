"use strict";
// History — a visit list grouped by day, filterable, with per-row removal.
//
// Was a flat stack of rows with the full URL under every title and a permanent
// × on the right; the page had no search at all, which for a list capped at
// 50k entries is the one control it cannot do without.
(() => {
    document.addEventListener('DOMContentLoaded', async () => {
        const listEl = document.getElementById('list');
        const searchEl = document.getElementById('search');
        const countEl = document.getElementById('count');
        const i18n = window.Ink?.i18n;
        try { i18n?.init((window.northstarSettings?.getSync() || {}).i18n || {}); i18n?.apply(document); }
        catch (e) { window.inkLog?.debug('history', 'i18n: ' + e); }
        // t() falls through to the key when a string is missing, so a plain
        // `|| fallback` never fires. This one checks for that.
        const T = (key, fallback) => {
            const v = i18n?.t(key);
            return (!v || v === key) ? fallback : v;
        };

        // A click anywhere on the page dismisses the chrome's menu (it is an
        // overlay above this view, so it cannot see the click itself).
        document.addEventListener('click', async () => {
            try { await window.menu?.close(); }
            catch (e) { window.inkLog?.debug('history', 'menu close: ' + e); }
        });

        let entries = [];
        try { entries = await window.browserHistory.get() || []; }
        catch (e) { window.inkLog?.debug('history', 'load: ' + e); }

        const dayKey = (iso) => {
            const d = new Date(iso);
            return Number.isNaN(d.getTime()) ? '' : d.toDateString();
        };
        const dayLabel = (iso) => {
            const d = new Date(iso);
            const today = new Date();
            const yesterday = new Date(Date.now() - 86400000);
            if (d.toDateString() === today.toDateString()) return T('history.today', 'Today');
            if (d.toDateString() === yesterday.toDateString()) return T('history.yesterday', 'Yesterday');
            return i18n ? i18n.date(d) : d.toLocaleDateString();
        };

        function hostOf(url) {
            try { return new URL(url).hostname.replace(/^www\./, ''); }
            catch { return url; }
        }

        function makeRow(entry) {
            const row = document.createElement('div');
            row.className = 'list-row';
            row.tabIndex = 0;
            row.setAttribute('role', 'link');

            // Favicon with a letter fallback — a list of titles alone is much
            // harder to scan than one with marks down its left edge.
            const host = hostOf(entry.url);
            const fallback = document.createElement('span');
            fallback.className = 'icon-fallback';
            fallback.textContent = (host || '·').charAt(0).toUpperCase();
            row.appendChild(fallback);
            (async () => {
                try {
                    const data = await window.faviconCache?.get(host);
                    if (!data) return;
                    const img = document.createElement('img');
                    img.className = 'icon';
                    img.src = data;
                    img.alt = '';
                    fallback.replaceWith(img);
                }
                catch (e) { window.inkLog?.debug('history', 'favicon: ' + e); }
            })();

            const text = document.createElement('div');
            text.className = 'text';
            const title = document.createElement('div');
            title.className = 'title';
            title.textContent = entry.title || host || 'Untitled';
            const sub = document.createElement('div');
            sub.className = 'sub';
            sub.textContent = entry.url;
            text.append(title, sub);
            row.appendChild(text);

            if (entry.profile) {
                const badge = document.createElement('span');
                badge.className = 'profile-badge';
                badge.textContent = entry.profileName || 'container';
                row.appendChild(badge);
            }

            const time = document.createElement('span');
            time.className = 'meta';
            const at = new Date(entry.timestamp);
            time.textContent = i18n ? i18n.time(at) : at.toLocaleTimeString();
            row.appendChild(time);

            const remove = document.createElement('button');
            remove.className = 'row-action';
            remove.title = T('history.remove', 'Remove from history');
            remove.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.29" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
            remove.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    if (await window.browserHistory.remove(entry.url, entry.timestamp)) {
                        entries = entries.filter(x => !(x.url === entry.url && x.timestamp === entry.timestamp));
                        render(searchEl.value);
                    }
                }
                catch (err) { window.inkLog?.debug('history', 'remove: ' + err); }
            });
            row.appendChild(remove);

            const open = () => {
                if (!entry.url) return;
                if (entry.profile && window.tab?.openInContainer)
                    window.tab.openInContainer(entry.profile, entry.url);
                else
                    window.electronAPI.navigateActiveTab(entry.url);
            };
            row.addEventListener('click', open);
            row.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
            });
            return row;
        }

        function render(query = '') {
            const q = query.trim().toLowerCase();
            const shown = q
                ? entries.filter(e => (e.title || '').toLowerCase().includes(q) || (e.url || '').toLowerCase().includes(q))
                : entries;
            listEl.textContent = '';
            countEl.textContent = shown.length
                ? (shown.length === 1
                    ? T('history.visit', '1 visit')
                    : T('history.visits', '{n} visits').replace('{n}', i18n ? i18n.number(shown.length) : shown.length))
                : '';

            if (!shown.length) {
                const empty = document.createElement('div');
                empty.className = 'page-empty';
                const strong = document.createElement('strong');
                strong.textContent = q
                    ? (T('history.noMatches', 'No matching pages'))
                    : (T('history.empty', 'Nothing here yet'));
                empty.append(strong, q
                    ? (T('history.noMatchesHint', 'Try a different word.'))
                    : (T('history.emptyHint', 'Pages you visit will show up here.')));
                listEl.appendChild(empty);
                return;
            }

            // One card per day, so the eye has something to anchor on when
            // scrolling months of visits.
            let currentDay = null, card = null;
            for (const entry of shown) {
                const key = dayKey(entry.timestamp);
                if (key !== currentDay) {
                    currentDay = key;
                    const wrap = document.createElement('section');
                    wrap.className = 'day';
                    const label = document.createElement('div');
                    label.className = 'group-label';
                    label.textContent = dayLabel(entry.timestamp);
                    card = document.createElement('div');
                    card.className = 'card';
                    wrap.append(label, card);
                    listEl.appendChild(wrap);
                }
                card.appendChild(makeRow(entry));
            }
        }

        searchEl.addEventListener('input', () => render(searchEl.value));
        document.getElementById('clear-all').addEventListener('click', async () => {
            try {
                await window.browserHistory.clear?.();
                entries = [];
                render(searchEl.value);
            }
            catch (e) { window.inkLog?.debug('history', 'clear: ' + e); }
        });
        render();
    });
})();
