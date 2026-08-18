# renderer/NewTab/

## Purpose

The surface behind a blank tab — and deliberately almost nothing. Opening a tab
raises the palette (`ipc/palette.js`, via `Tabs.promptForBlankTab()`), so this
page holds the space until a real page arrives instead of being a destination
of its own. It has no search field: a second one competing with the address bar
is what the palette replaced.

It makes **no network requests** — no weather, no geolocation, no external
fonts.

| File | What it is |
|---|---|
| `index.html` | the blank surface: a faint mark and one hint line |
| `private.html` | the same surface with violet light and a PRIVATE marker |
| `styles.css` | shared by both; `.rest` / `.mark` / `.hint`, plus the leave fade |
| `newtab.js` | shared by both; localises the page and writes the hint |

## `newtab.js`

Both pages are `file://`, so the settings bridge is present and the i18n
catalogue can be read synchronously: the script calls `Ink.i18n.init()` +
`apply(document)` (which localises `data-i18n` markup, e.g. the PRIVATE pill),
then fills `#hint` with the shortcut that reopens the palette — `⌘T` on macOS,
`Ctrl+T` elsewhere — through `newtab.hint` / `newtab.hintTail`. Strings fall
back to the English already in the markup if no catalogue is available.

## Fading out

Chromium keeps the old document painted until the next one commits, so
`features/tabs.js` adds `html.leaving` when a real navigation starts; the CSS
fades `.rest` out over 140 ms rather than letting the blank surface sit there
for the whole network wait.
