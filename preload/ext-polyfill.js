/**
 * Extension API gap layer — fills the chrome.* namespaces that neither Electron
 * nor electron-chrome-extensions provides.
 *
 * WHAT THE STACK ALREADY GIVES US (verified by probing a live worker, not by
 * reading docs): Chromium/Electron natively provide storage, tabs, windows,
 * cookies, webNavigation, contextMenus, notifications, permissions, offscreen,
 * i18n, webRequest, management, downloads, privacy, topSites, scripting, alarms
 * and idle; electron-chrome-extensions adds browserAction, commands and
 * runtime (including connectNative/sendNativeMessage).
 *
 * WHAT IS ACTUALLY MISSING, and supplied here: tabCapture, history, bookmarks,
 * sidePanel, identity, proxy, devtools — plus declarativeNetRequest, which is a
 * special case explained at its section below. Namespaces are added only when
 * absent (DNR excepted), so anything the platform gains later silently wins
 * over ours.
 *
 * STILL ABSENT, deliberately: sessions, browsingData, contentSettings,
 * declarativeContent, debugger, pageCapture, tts, fontSettings, printerProvider,
 * system.*, power. Each needs browser state we do not keep, and a stub that
 * resolves without doing anything is worse than a missing namespace — the
 * extension reports success and silently misbehaves.
 *
 * WHY THIS IS AWKWARD: two things defeat the obvious approach.
 *   1. A service-worker preload runs in an ISOLATED world, so assigning to
 *      globalThis.chrome here is invisible to the worker. Reaching it needs
 *      contextBridge.executeInMainWorld — the same route the library uses.
 *   2. The library calls Object.freeze(chrome) once it has installed its APIs,
 *      and preloads run in registration order — ours is after theirs, so the
 *      object is already frozen and a plain assignment silently does nothing.
 *      Hence the copy-and-rebind below rather than a mutation.
 *
 * Because executeInMainWorld serialises the function, mainWorldScript() cannot
 * close over anything in this file — it reaches back only through the bridge
 * object exposed as globalThis.__inkExtBridge.
 */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Handed to the main world; it cannot reach ipcRenderer by itself.
//
// The channel guard matters: this bridge is exposed to extension pages, which
// are third-party code. Without it an extension could invoke ANY ipcMain
// channel in the browser — including the password and settings ones. Only the
// gap layer's own 'ext:' namespace is reachable.
const ALLOWED = /^ext:/;
const guard = (channel) => {
    if (!ALLOWED.test(String(channel)))
        throw new Error(`blocked channel: ${channel}`);
    return channel;
};
const bridge = {
    invoke: (channel, payload) => ipcRenderer.invoke(guard(channel), payload),
    on: (channel, cb) => ipcRenderer.on(guard(channel), (_e, data) => cb(data)),
    reportGap: (id, api) => { try { ipcRenderer.send('ext:unsupported', { id, api }); } catch { } },
    // inspectedWindow.tabId must be readable synchronously, and the main-world
    // script cannot reach ipcRenderer, so it is resolved here and passed along.
    // Filled in below for devtools pages only — a sendSync at module scope would
    // fire on every single page load.
    devtoolsTabId: -1,
};

// Runs INSIDE the worker's own global scope.
function mainWorldScript() {
    const api = globalThis.__inkExtBridge;
    const current = globalThis.chrome;
    if (!api || !current)
        return;

    // ── helpers ──────────────────────────────────────────────────────────────
    // Chrome APIs are dual-mode: a trailing callback OR a returned promise.
    // Extensions use both, so every method below has to honour whichever it got.
    const dual = (fn) => function (...args) {
        let cb = null;
        if (typeof args[args.length - 1] === 'function')
            cb = args.pop();
        const p = Promise.resolve()
            .then(() => fn(...args))
            .catch((err) => {
                // Best-effort: chrome.runtime may be frozen, in which case
                // callers just get the rejection instead of lastError.
                try { globalThis.chrome.runtime.lastError = { message: String(err && err.message || err) }; }
                catch { }
                throw err;
            });
        if (!cb)
            return p;
        p.then((v) => cb(v), () => cb(undefined));
        return undefined;
    };
    // A chrome.events.Event backed by one main-process push channel. Nothing is
    // subscribed until an extension actually adds a listener.
    const makeEvent = (channel, transform) => {
        const listeners = new Set();
        let wired = false;
        return {
            addListener(fn) {
                listeners.add(fn);
                if (!wired) {
                    wired = true;
                    api.on(channel, (data) => {
                        const args = transform ? transform(data) : [data];
                        for (const l of listeners) {
                            try { l(...args); }
                            catch { }
                        }
                    });
                }
            },
            removeListener(fn) { listeners.delete(fn); },
            hasListener(fn) { return listeners.has(fn); },
            hasListeners() { return listeners.size > 0; },
        };
    };

    const add = {}; // namespace name → implementation

    // ── chrome.tabCapture ────────────────────────────────────────────────────
    if (!current.tabCapture) {
        add.tabCapture = {
            getMediaStreamId: dual((options = {}) => api.invoke('ext:getMediaStreamId', {
                targetTabId: options.targetTabId ?? null,
                consumerTabId: options.consumerTabId ?? null,
            })),
            capture: dual(() => {
                api.reportGap(current.runtime && current.runtime.id, 'chrome.tabCapture.capture');
                throw new Error('chrome.tabCapture.capture is not implemented');
            }),
            getCapturedTabs: dual(() => []),
            onStatusChanged: makeEvent('ext:tabCapture.status'),
        };
    }

    // ── chrome.declarativeNetRequest ─────────────────────────────────────────
    // The API every MV3 content blocker is built on.
    //
    // This one is deliberately NOT guarded on absence. Chromium exposes the full
    // DNR surface inside Electron, but the ruleset manager behind it is never
    // wired up: updateDynamicRules resolves, getDynamicRules echoes the rules
    // back, and absolutely nothing is ever blocked. getEnabledRulesets() even
    // returns [] for a static ruleset declared and enabled in the manifest.
    // Deferring to that shell is worse than having no API at all, because a
    // content blocker reports success while silently doing nothing — so we
    // replace it wholesale with an implementation that actually enforces.
    {
        add.declarativeNetRequest = {
            updateDynamicRules: dual((o = {}) => api.invoke('ext:dnr.updateRules', { kind: 'dynamic', ...o })),
            getDynamicRules: dual(() => api.invoke('ext:dnr.getRules', { kind: 'dynamic' })),
            updateSessionRules: dual((o = {}) => api.invoke('ext:dnr.updateRules', { kind: 'session', ...o })),
            getSessionRules: dual(() => api.invoke('ext:dnr.getRules', { kind: 'session' })),
            updateEnabledRulesets: dual((o = {}) => api.invoke('ext:dnr.updateEnabledRulesets', o)),
            getEnabledRulesets: dual(() => api.invoke('ext:dnr.getEnabledRulesets', {})),
            getAvailableStaticRuleCount: dual(() => api.invoke('ext:dnr.getAvailableStaticRuleCount', {})),
            getMatchedRules: dual((filter) => api.invoke('ext:dnr.getMatchedRules', { filter: filter || null })),
            testMatchOutcome: dual((request) => api.invoke('ext:dnr.testMatchOutcome', { request })),
            isRegexSupported: dual((o = {}) => api.invoke('ext:dnr.isRegexSupported', o)),
            setExtensionActionOptions: dual(() => undefined),
            updateStaticRules: dual(() => undefined),
            getDisabledRuleIds: dual(() => []),
            onRuleMatchedDebug: makeEvent('ext:dnr.ruleMatched'),
            // Constants extensions branch on.
            DYNAMIC_RULESET_ID: '_dynamic',
            SESSION_RULESET_ID: '_session',
            MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES: 5000,
            MAX_NUMBER_OF_STATIC_RULESETS: 100,
            MAX_NUMBER_OF_ENABLED_STATIC_RULESETS: 50,
            MAX_NUMBER_OF_REGEX_RULES: 1000,
            GETMATCHEDRULES_QUOTA_INTERVAL: 10,
            MAX_GETMATCHEDRULES_CALLS_PER_INTERVAL: 20,
            ResourceType: {
                MAIN_FRAME: 'main_frame', SUB_FRAME: 'sub_frame', STYLESHEET: 'stylesheet',
                SCRIPT: 'script', IMAGE: 'image', FONT: 'font', OBJECT: 'object',
                XMLHTTPREQUEST: 'xmlhttprequest', PING: 'ping', CSP_REPORT: 'csp_report',
                MEDIA: 'media', WEBSOCKET: 'websocket', OTHER: 'other',
            },
            RuleActionType: {
                BLOCK: 'block', REDIRECT: 'redirect', ALLOW: 'allow',
                UPGRADE_SCHEME: 'upgradeScheme', MODIFY_HEADERS: 'modifyHeaders',
                ALLOW_ALL_REQUESTS: 'allowAllRequests',
            },
            HeaderOperation: { APPEND: 'append', SET: 'set', REMOVE: 'remove' },
            DomainType: { FIRST_PARTY: 'firstParty', THIRD_PARTY: 'thirdParty' },
        };
    }

    // ── chrome.history ───────────────────────────────────────────────────────
    if (!current.history) {
        add.history = {
            search: dual((q = {}) => api.invoke('ext:history.search', q)),
            getVisits: dual((o = {}) => api.invoke('ext:history.getVisits', o)),
            addUrl: dual((o = {}) => api.invoke('ext:history.addUrl', o)),
            deleteUrl: dual((o = {}) => api.invoke('ext:history.deleteUrl', o)),
            deleteRange: dual((o = {}) => api.invoke('ext:history.deleteRange', o)),
            deleteAll: dual(() => api.invoke('ext:history.deleteAll', {})),
            onVisited: makeEvent('ext:history.visited'),
            onVisitRemoved: makeEvent('ext:history.visitRemoved'),
        };
    }

    // ── chrome.bookmarks ─────────────────────────────────────────────────────
    if (!current.bookmarks) {
        add.bookmarks = {
            get: dual((id) => api.invoke('ext:bookmarks.get', { id })),
            getChildren: dual((id) => api.invoke('ext:bookmarks.getChildren', { id })),
            getTree: dual(() => api.invoke('ext:bookmarks.getTree', {})),
            getSubTree: dual((id) => api.invoke('ext:bookmarks.getSubTree', { id })),
            getRecent: dual((count) => api.invoke('ext:bookmarks.getRecent', { count })),
            search: dual((query) => api.invoke('ext:bookmarks.search', { query })),
            create: dual((b) => api.invoke('ext:bookmarks.create', { bookmark: b })),
            update: dual((id, changes) => api.invoke('ext:bookmarks.update', { id, changes })),
            move: dual((id, dest) => api.invoke('ext:bookmarks.move', { id, dest })),
            remove: dual((id) => api.invoke('ext:bookmarks.remove', { id })),
            removeTree: dual((id) => api.invoke('ext:bookmarks.remove', { id, tree: true })),
            onCreated: makeEvent('ext:bookmarks.created', (d) => [d.id, d.node]),
            onRemoved: makeEvent('ext:bookmarks.removed', (d) => [d.id, d.info]),
            onChanged: makeEvent('ext:bookmarks.changed', (d) => [d.id, d.info]),
            onMoved: makeEvent('ext:bookmarks.moved', (d) => [d.id, d.info]),
            onChildrenReordered: makeEvent('ext:bookmarks.reordered', (d) => [d.id, d.info]),
        };
    }

    // ── chrome.identity ──────────────────────────────────────────────────────
    if (!current.identity) {
        add.identity = {
            launchWebAuthFlow: dual((details = {}) => api.invoke('ext:identity.launchWebAuthFlow', {
                url: details.url, interactive: details.interactive !== false,
            })),
            // Synchronous in Chrome. The id is derivable from our own origin, so
            // no IPC is needed.
            getRedirectURL: (path = '') => {
                let id = '';
                try { id = current.runtime?.id || location.hostname; }
                catch { }
                return `https://${id}.chromiumapp.org/${String(path).replace(/^\/+/, '')}`;
            },
            // Needs a browser-level signed-in account to mint from; there is
            // none here, and a fake token fails confusingly deep inside the
            // extension. Fail loudly and point at the flow that does work.
            getAuthToken: dual(() => {
                api.reportGap(current.runtime && current.runtime.id, 'chrome.identity.getAuthToken');
                throw new Error('chrome.identity.getAuthToken is not supported; use launchWebAuthFlow');
            }),
            removeCachedAuthToken: dual(() => ({})),
            clearAllCachedAuthTokens: dual(() => undefined),
            getProfileUserInfo: dual(() => ({ email: '', id: '' })),
            getAccounts: dual(() => []),
            onSignInChanged: makeEvent('ext:identity.signInChanged'),
        };
    }

    // ── chrome.proxy ─────────────────────────────────────────────────────────
    if (!current.proxy) {
        // chrome.proxy exposes one ChromeSetting, not plain methods.
        add.proxy = {
            settings: {
                set: dual((details = {}) => api.invoke('ext:proxy.set', { value: details.value, scope: details.scope })),
                get: dual(() => api.invoke('ext:proxy.get', {})),
                clear: dual(() => api.invoke('ext:proxy.clear', {})),
                onChange: makeEvent('ext:proxy.change'),
            },
            onProxyError: makeEvent('ext:proxy.error'),
        };
    }

    // ── chrome.devtools ──────────────────────────────────────────────────────
    // Only for pages we deliberately loaded as an extension's devtools_page —
    // features/devtools-ext.js tags those with ?__inkDevtools=1. Every other
    // extension page must NOT see this namespace, exactly as in Chrome.
    let isDevtoolsPage = false;
    try { isDevtoolsPage = typeof location !== 'undefined' && /(?:\?|&)__inkDevtools=1(?:&|$)/.test(location.search); }
    catch { }
    if (isDevtoolsPage && !current.devtools) {
        const noop = () => { };
        const paneStub = () => ({
            setPage: noop, setObject: noop, setExpression: noop, setHeight: noop,
            onShown: makeEvent('ext:devtools.never'), onHidden: makeEvent('ext:devtools.never'),
        });
        add.devtools = {
            inspectedWindow: {
                // Chrome runs one devtools_page per inspected tab; we run one
                // hidden page, so this is the tab that was active when it
                // loaded. eval() below always targets the CURRENT active tab.
                tabId: api.devtoolsTabId ?? -1,
                // Chrome's signature is eval(expr, options?, callback) and the
                // callback takes (result, exceptionInfo) — not a lone value.
                eval: function (expression, optionsOrCb, maybeCb) {
                    const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
                    const p = api.invoke('ext:devtools.eval', { expression });
                    if (!cb)
                        return p.then(r => r.value);
                    p.then((r) => cb(r.value, r.error ? { isError: true, value: r.error } : undefined),
                        (e) => cb(undefined, { isError: true, value: String(e && e.message || e) }));
                    return undefined;
                },
                reload: (opts = {}) => { api.invoke('ext:devtools.reload', { ignoreCache: !!opts.ignoreCache }); },
                // Backed by the DevTools resource tracker in Chrome; we have no
                // equivalent, so report nothing rather than invent entries.
                getResources: dual(() => []),
                onResourceAdded: makeEvent('ext:devtools.never'),
                onResourceContentCommitted: makeEvent('ext:devtools.never'),
            },
            panels: {
                themeName: 'default',
                create: function (title, iconPath, pagePath, cb) {
                    const p = api.invoke('ext:devtools.createPanel', { title, iconPath, pagePath });
                    const panel = {
                        onShown: makeEvent('ext:devtools.panelShown'),
                        onHidden: makeEvent('ext:devtools.panelHidden'),
                        onSearch: makeEvent('ext:devtools.never'),
                        createStatusBarButton: () => ({ onClicked: makeEvent('ext:devtools.never'), update: noop }),
                    };
                    p.then(() => { if (cb) try { cb(panel); } catch { } });
                    return undefined;
                },
                // These attach to the DevTools Elements/Sources trees, which we
                // cannot reach — the panes exist but do nothing.
                elements: {
                    createSidebarPane: (t, cb) => { if (cb) try { cb(paneStub()); } catch { } },
                    onSelectionChanged: makeEvent('ext:devtools.never'),
                },
                sources: {
                    createSidebarPane: (t, cb) => { if (cb) try { cb(paneStub()); } catch { } },
                    onSelectionChanged: makeEvent('ext:devtools.never'),
                },
                setOpenResourceHandler: noop,
                openResource: noop,
            },
            network: {
                getHAR: dual(() => ({ log: { version: '1.2', creator: { name: 'ink', version: '1' }, entries: [] } })),
                onRequestFinished: makeEvent('ext:devtools.requestFinished'),
                onNavigated: makeEvent('ext:devtools.navigated'),
            },
        };
    }

    // ── chrome.sidePanel ─────────────────────────────────────────────────────
    if (!current.sidePanel) {
        add.sidePanel = {
            setOptions: dual((o = {}) => api.invoke('ext:sidePanel.setOptions', o)),
            getOptions: dual((o = {}) => api.invoke('ext:sidePanel.getOptions', o)),
            setPanelBehavior: dual((o = {}) => api.invoke('ext:sidePanel.setPanelBehavior', o)),
            open: dual((o = {}) => api.invoke('ext:sidePanel.open', o)),
        };
    }

    if (!Object.keys(add).length)
        return;
    // chrome is frozen, so rebuild it with the extra namespaces and rebind. The
    // binding itself is writable even though the object is not.
    const next = {};
    for (const key of Reflect.ownKeys(current)) {
        // Skip anything we are replacing. Chromium defines its API properties
        // as non-configurable, so copying one first makes the later override
        // throw and leaves the native (non-functional) surface in place — which
        // is exactly how the declarativeNetRequest override silently lost.
        if (Object.prototype.hasOwnProperty.call(add, key))
            continue;
        const desc = Object.getOwnPropertyDescriptor(current, key);
        try { Object.defineProperty(next, key, desc); }
        catch { }
    }
    for (const [name, impl] of Object.entries(add)) {
        // Marker so a probe can tell OUR implementation from a native one —
        // the guards above skip any namespace Chromium already provides, and
        // knowing which is which is the difference between a real gap and a
        // duplicated API.
        try { Object.defineProperty(impl, '__inkPolyfill', { value: true, enumerable: false }); }
        catch { }
        try { Object.defineProperty(next, name, { value: impl, enumerable: true, configurable: true }); }
        catch { }
    }
    try { globalThis.chrome = next; }
    catch { }
}

// This script is registered BOTH as a service-worker preload and as a frame
// preload (extension popups/options call these APIs too). The frame
// registration is session-wide, so bail immediately on ordinary web pages —
// they must never see the bridge, and this runs on every page load.
function isExtensionContext() {
    try {
        if (typeof location !== 'undefined' && location.protocol)
            return location.protocol === 'chrome-extension:';
    }
    catch { }
    return true; // unknown context (service worker startup) — let it through
}

// Only a devtools page pays for the synchronous tabId lookup.
function isDevtoolsPage() {
    try { return typeof location !== 'undefined' && /(?:\?|&)__inkDevtools=1(?:&|$)/.test(location.search); }
    catch { return false; }
}

try {
    if (!isExtensionContext())
        return; // ordinary web page — nothing to install
    if (isDevtoolsPage()) {
        try { bridge.devtoolsTabId = ipcRenderer.sendSync('ext:devtools.tabIdSync') ?? -1; }
        catch { }
    }
    if (!process.contextIsolated) {
        // No isolation: this scope IS the worker's, so run it directly.
        globalThis.__inkExtBridge = bridge;
        mainWorldScript();
    }
    else {
        contextBridge.exposeInMainWorld('__inkExtBridge', bridge);
        if ('executeInMainWorld' in contextBridge)
            contextBridge.executeInMainWorld({ func: mainWorldScript });
        else
            console.warn('[ink] executeInMainWorld unavailable — extension gap APIs not installed');
    }
}
catch (e) {
    try { console.warn('[ink] extension polyfill failed:', e && e.message); }
    catch { }
}
