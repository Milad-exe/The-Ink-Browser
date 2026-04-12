# renderer/Bruno/bruno.js

## Purpose

Renderer script for the Bruno HTTP client panel. A full API client UI running inside a `WebContentsView` sidebar. Manages multiple collections, each with requests and environments. Supports creating, saving, loading, and executing HTTP requests with environment variable substitution (`{{variableName}}` syntax). State is persisted between sessions via `window.bruno.saveState` / `loadState`.

---

## Key State Variables

| Variable | Type | Purpose |
|---|---|---|
| `collections` | `Array` | Loaded collection objects, each containing `{ path, name, requests, envs, activeEnvPath, envVariables, openFolders }` |
| `currentCollectionPath` | `string\|null` | Path of the collection the currently active request belongs to |
| `currentRequest` | `object\|null` | The full request object currently open in the editor |
| `editingEnvCollectionPath` | `string\|null` | Which collection's environment modal is open |
| `editingEnvPath` | `string\|null` | File path of the environment currently being edited |

---

## Key Functions

### `escapeHtml(str)`
HTML-escapes a string to prevent XSS when inserting user content into innerHTML.

### `getActiveEnvVars()`
Returns the active environment's variable map `{ name: value }` for `currentCollectionPath`.
- **Returns** `object`

### `substituteVars(str)`
Replaces `{{varName}}` placeholders in `str` with values from the active environment.
- **Returns** `string`

### `saveState()` *(async)*
Persists the current open collections, active request, and environment selections via `window.bruno.saveState`.

### `restoreState()` *(async)*
Reloads previously open collections, re-selects environments, and reopens the last active request.

### `loadCollection(dirPath, focusFirst?)` *(async)*
Opens a collection directory: loads `bruno.json` metadata, scans requests and environments, and adds the collection to `collections`. Optionally focuses the first request.
- **Returns** the new collection object, or `null` on failure

### `selectRequest(filename, collectionPath)` *(async)*
Opens a request in the editor. Loads the request file from disk and renders the editor fields (method, URL, headers, params, body, auth, docs).

### `sendRequest()` *(async)*
Executes the current request using the Fetch API. Applies environment variable substitution to the URL, headers, and body. Displays the response status, headers, and body in the response panel.

### `renderTree()`
Renders the left-side request tree. Groups requests by folder path. Supports collapsible folders stored in `col.openFolders`.

### `renderEnvSelector()`
Renders the environment selector dropdown for each collection.

### `selectEnvironmentForCollection(col, envPath, persist?)` *(async)*
Loads environment variables for `col` from `envPath` and stores them in `col.envVariables`. Optionally saves the active environment to `bruno.json`.

---

## Initialization (`DOMContentLoaded`)

1. Calls `restoreState()`
2. Sets up button event handlers: open collection, create collection, create request, send request, save request
3. Sets up environment modal open/close/save handlers
4. Sets up tab switching in the request editor (Headers, Params, Body, Auth, Docs)
