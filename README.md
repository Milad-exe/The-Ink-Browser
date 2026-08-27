# Northstar

A quiet browser, built on Electron.

Spaces instead of a wall of tabs, a sidebar instead of a top strip, and a
per-space theme you can build yourself. No new-tab page: a window opens with
nothing in it and stays that way until you ask for something.

## Running it

```bash
npm install
npm start
```

`npm run dev` watches the tree and reloads. CSS hot-swaps everywhere; panels and
internal pages reload in place; the chrome's own scripts and markup restart the
app, because its tab strip is built from pushed events and cannot be reloaded
without losing them.

## Building

```bash
npm run dist          # every platform this host can build
npm run dist:mac      # or win / linux
```

Builds are Widevine-signed through castlabs so DRM playback works. Set
`SKIP_VMP=1` for an unsigned local build.

## Tests

```bash
npm run test:unit         # pure logic, no Electron, ~0.2s
npm run smoke             # boots the app and checks it came up clean
npm run test:e2e          # Playwright against the real UI (--quick skips the site battery)
```

## Layout

The repo root *is* the app — plain CommonJS, no build step, Electron runs the
files in place.

| | |
|---|---|
| `main.js` | entry point |
| `features/` | main-process logic — tabs, windows, themes, extensions, privacy |
| `ipc/` | ipcMain handlers, one file per area |
| `preload/` | the `window.*` bridges each surface gets |
| `renderer/` | the UI: `Browser/` is the chrome, the rest are pages and panels |
| `locales/` | interface strings |

`features/tabs.js` is the hub: one `WebContentsView` per tab, with its larger
concerns split into `features/tabs/*.js`.

Anything drawn over a page — menus, panels, prompts — is its own
`WebContentsView`, because the page is a native view and chrome DOM can never
paint on top of it.

## Contributing

`CLAUDE.md` at the root is the working brief: the design rules, the invariants
that have caused real bugs, and how to verify a change. Read it before making
one.
