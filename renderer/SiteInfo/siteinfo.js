"use strict";
// IIFE: compiled as a classic <script>; the wrapper keeps this page's
// top-level names out of the shared global scope.
(() => {
    const T = (key, fallback) => {
        try { const v = window.Northstar?.i18n?.t(key); return (v && v !== key) ? v : fallback; }
        catch (e) { return fallback; }
    };
    try {
        window.Northstar.i18n.init(window.northstarI18n?.getSync() || {});
        window.Northstar.i18n.apply(document);
    }
    catch (e) { window.northstarLog?.debug('siteinfo', 'i18n: ' + e); }
    const api = window.siteInfoApi;
    const LOCK = '<svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M208,76H180V56A52,52,0,0,0,76,56V76H48A20,20,0,0,0,28,96V208a20,20,0,0,0,20,20H208a20,20,0,0,0,20-20V96A20,20,0,0,0,208,76ZM100,56a28,28,0,0,1,56,0V76H100ZM204,204H52V100H204Z"/></svg>';
    const WARN = '<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M240.26,186.1,152.81,34.23h0a28.74,28.74,0,0,0-49.62,0L15.74,186.1a27.45,27.45,0,0,0,0,27.71A28.31,28.31,0,0,0,40.55,228h174.9a28.31,28.31,0,0,0,24.79-14.19A27.45,27.45,0,0,0,240.26,186.1Zm-20.8,15.7a4.46,4.46,0,0,1-4,2.2H40.55a4.46,4.46,0,0,1-4-2.2,3.56,3.56,0,0,1,0-3.73L124,46.2a4.77,4.77,0,0,1,8,0l87.44,151.87A3.56,3.56,0,0,1,219.46,201.8ZM116,136V104a12,12,0,0,1,24,0v32a12,12,0,0,1-24,0Zm28,40a16,16,0,1,1-16-16A16,16,0,0,1,144,176Z"/></svg>';
    const esc = (s) => String(s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    function permRow(p) {
        const row = document.createElement('div');
        row.className = 'perm';
        const label = document.createElement('span');
        label.className = 'perm-label';
        label.textContent = p.label;
        // Three explicit states. The default is "Ask" (block-by-default: the site
        // must prompt before using the resource) — it must NOT read as "Allow".
        const seg = document.createElement('div');
        seg.className = 'seg';
        const ask = document.createElement('button');
        ask.textContent = T('site.ask', 'Ask');
        const allow = document.createElement('button');
        allow.textContent = T('site.allow', 'Allow');
        const block = document.createElement('button');
        block.textContent = T('site.block', 'Block');
        const paint = (state) => {
            const s = (state === 'allow' || state === 'block') ? state : 'ask';
            ask.classList.toggle('on', s === 'ask');
            allow.classList.toggle('on', s === 'allow');
            block.classList.toggle('on', s === 'block');
        };
        paint(p.state);
        // 'ask' clears any stored decision (Features/site-permissions.js#set).
        ask.addEventListener('click', () => { paint('ask'); api.setPermission(p.name, 'ask'); });
        allow.addEventListener('click', () => { paint('allow'); api.setPermission(p.name, 'allow'); });
        block.addEventListener('click', () => { paint('block'); api.setPermission(p.name, 'block'); });
        seg.appendChild(ask);
        seg.appendChild(allow);
        seg.appendChild(block);
        row.appendChild(label);
        row.appendChild(seg);
        return row;
    }
    async function render() {
        let info = {};
        try {
            info = await api.getInfo();
        }
        catch (e) { window.northstarLog?.debug('siteinfo', 'render: ' + e); }
        const conn = document.getElementById('conn');
        conn.className = 'conn ' + (info.secure ? 'secure' : 'insecure');
        conn.innerHTML =
            `<span class="conn-icon">${info.secure ? LOCK : WARN}</span>` +
                `<div><div class="conn-title">${info.secure ? T('site.secure', 'Connection is secure') : T('site.insecure', 'Connection is not secure')}</div>` +
                `<div class="host">${esc(info.host)}</div></div>`;
        // Protections shield — checked = protections ON for this site.
        const shieldToggle = document.getElementById('shield-toggle');
        const shieldDesc = document.getElementById('shield-desc');
        shieldToggle.checked = !info.protectionOff;
        shieldDesc.textContent = info.protectionOff
            ? T('site.protectionsOff', 'Protections are off for this site')
            : T('site.protectionsOn', 'Blocking ads and trackers on this site');
        shieldToggle.addEventListener('change', () => {
            // Persist + close + reload happen main-side.
            api.setProtection(!shieldToggle.checked);
        });
        const perms = document.getElementById('perms');
        perms.innerHTML = '';
        const list = info.permissions || [];
        if (list.length)
            list.forEach(p => perms.appendChild(permRow(p)));
        else
            perms.innerHTML = `<div class="perm-empty">${esc(T('site.noPermissions', 'No permissions requested'))}</div>`;
        const clearBtn = document.getElementById('clear');
        if (typeof info.cookieCount === 'number' && info.cookieCount > 0) {
            clearBtn.textContent = `${T('site.clear', 'Clear cookies and site data')} (${info.cookieCount})`;
        }
        clearBtn.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.textContent = T('site.clearing', 'Clearing…');
            try {
                await api.clearData();
            }
            catch (e) { window.northstarLog?.debug('siteinfo', 'render: ' + e); }
            btn.textContent = T('site.cleared', 'Cleared');
            setTimeout(() => api.close(), 700);
        });
        // Size the overlay view to the card's actual height.
        requestAnimationFrame(() => {
            const h = document.getElementById('card').getBoundingClientRect().height;
            api.resize(h + 14);
        });
    }
    document.addEventListener('DOMContentLoaded', render);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape')
        api.close(); });
})();
