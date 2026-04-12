# Features/Bruno

---

## collections.js

### Purpose

Provides module-level utility functions for managing Bruno collection directories. A collection is a filesystem directory; its root-level `bruno.json` file stores metadata such as the collection name, schema version, and the currently active environment. Consumed by `Features/Bruno/index.js`.

### Functions

#### `initCollection(dirPath)`
Ensures `dirPath` exists and contains a valid `bruno.json`. Creates it with defaults if absent. Returns metadata merged with the directory path.
- **Inputs:** `dirPath` — `string` — absolute path to the collection directory
- **Outputs:** `{ name, version, activeEnvironment, path } | null` — or `null` if the directory does not exist; throws on filesystem error

#### `getActiveEnvironment(dirPath)`
Reads `bruno.json` and returns the `activeEnvironment` field.
- **Inputs:** `dirPath` — `string`
- **Outputs:** `string | null`

#### `setActiveEnvironment(dirPath, envName)`
Updates `activeEnvironment` in `bruno.json`, creating the file if absent.
- **Inputs:** `dirPath` — `string`; `envName` — `string | null`
- **Outputs:** `boolean` — `true` on success; throws on error

#### `listCollections(dirPath)`
Scans `dirPath` for subdirectories containing `bruno.json`.
- **Inputs:** `dirPath` — `string`
- **Outputs:** `Array<{ name, path }>` — empty array if `dirPath` does not exist

#### `getCollectionInfo(collectionPath)`
Returns basic filesystem metadata for a single collection directory.
- **Inputs:** `collectionPath` — `string`
- **Outputs:** `{ name, path, isDirectory, created, modified } | null`

### Key Variables

| Name | Type | Purpose |
|---|---|---|
| `BRUNO_JSON` | `string` (`'bruno.json'`) | The metadata filename; referenced throughout the module for consistency |

---

## environments.js

### Purpose

Provides the `EnvironmentManager` class for all CRUD operations on Bruno environment files. Each environment is stored as `{collectionPath}/environments/{name}.json`. Format: `{ name, variables: [{ name, value, enabled, secret }] }`. Used by `Features/Bruno/index.js`.

### Methods

#### `envDir(collectionPath)`
Returns the path to the `environments` subdirectory.
- **Inputs:** `collectionPath` — `string`
- **Outputs:** `string`

#### `createEnvironment(collectionPath, envName)`
Creates a new environment file. Throws if one with the same name already exists.
- **Inputs:** `collectionPath` — `string`; `envName` — `string`
- **Outputs:** `{ name, path }` — throws if already exists or on filesystem error

#### `listEnvironments(collectionPath)`
Returns metadata for every `.json` file in the `environments` subdirectory.
- **Inputs:** `collectionPath` — `string`
- **Outputs:** `Array<{ name, path }>` — empty array if the directory does not exist

#### `loadEnvironment(envPath)`
Loads an environment and returns enabled variables as a flat key-value map for `{{var}}` substitution.
- **Inputs:** `envPath` — `string`
- **Outputs:** `{ [name: string]: string }` — empty object on error

#### `loadEnvironmentFull(envPath)`
Loads the full environment document including disabled and secret variables.
- **Inputs:** `envPath` — `string`
- **Outputs:** `{ name, variables: Array<{ name, value, enabled, secret }> }`

#### `saveEnvironment(envPath, variables)`
Writes an updated variables array into an environment file, preserving the `name` field.
- **Inputs:** `envPath` — `string`; `variables` — `Array<{ name, value, enabled, secret }>`
- **Outputs:** `boolean` — `true` on success; throws on error

#### `deleteEnvironment(envPath)`
Deletes an environment file. Does nothing if the file does not exist.
- **Inputs:** `envPath` — `string`
- **Outputs:** `boolean` — `true` on success

---

## export-import.js

### Purpose

Provides two functions for exporting and importing Bruno collections. `exportCollection` assembles a collection's requests and environment files into a single plain object. `importCollection` writes that object back to disk. Called by `Features/Bruno/index.js` in response to IPC events.

### Functions

#### `exportCollection(collectionPath)`
Reads the immediate contents of `collectionPath` and collects `.json` files as requests and `.env` files as environments.
- **Inputs:** `collectionPath` — `string`
- **Outputs:** `{ name, requests: Array<object>, environments: Array<{ name, content }> }` — throws on error

#### `importCollection(collectionData, targetPath)`
Writes requests and environments from a collection object to `targetPath`. Creates the directory if absent.
- **Inputs:** `collectionData` — `object` (same shape as `exportCollection` output); `targetPath` — `string`
- **Outputs:** `boolean` — `true` on success; throws on error

---

## files.js

### Purpose

Provides three async functions for low-level filesystem operations on Bruno collection files: writing, reading, and deleting. Parent directories are created automatically. Used by `Features/Bruno/index.js` for generic file operations.

### Functions

#### `saveCollectionFile(filePath, data)`
Writes `data` to `filePath`, creating intermediate directories as needed.
- **Inputs:** `filePath` — `string`; `data` — `string`
- **Outputs:** `Promise<boolean>` — throws on error

#### `loadCollectionFile(filePath)`
Reads `filePath` and parses it as JSON.
- **Inputs:** `filePath` — `string`
- **Outputs:** `Promise<object>` — throws if unreadable or not valid JSON

#### `deleteCollectionFile(filePath)`
Deletes `filePath` if it exists; silently succeeds if absent.
- **Inputs:** `filePath` — `string`
- **Outputs:** `Promise<boolean>` — throws on error

---

## git.js

### Purpose

Provides four functions for basic Git operations on Bruno collection directories. All commands are executed synchronously via `child_process.execSync`. Exposed to the renderer via IPC through `Features/Bruno/index.js`.

### Functions

#### `gitInit(dirPath)`
Runs `git init` in `dirPath`. Does nothing if `.git` already exists.
- **Inputs:** `dirPath` — `string`
- **Outputs:** `boolean` — `true` on success; throws on error

#### `isGitRepo(dirPath)`
Checks whether a `.git` subdirectory exists in `dirPath`.
- **Inputs:** `dirPath` — `string`
- **Outputs:** `boolean` — `false` on error

#### `gitStatus(dirPath)`
Returns the porcelain-format git status of a repository.
- **Inputs:** `dirPath` — `string`
- **Outputs:** `string` — empty string on error

#### `createGitignore(dirPath)`
Creates a `.gitignore` with default rules (`node_modules/`, `.env`, `.DS_Store`, `*.log`). Does nothing if one already exists.
- **Inputs:** `dirPath` — `string`
- **Outputs:** `boolean` — `true` on success; throws on error

---

## index.js

### Purpose

Main entry point for the Bruno feature. Instantiates all sub-modules (UI, requests, environments, files, collections, git, export/import) and registers every IPC handler the renderer uses. The `Bruno` class acts as a single coordinator routing each IPC channel to the appropriate sub-module. Also manages session-state persistence via a JSON file in the user-data directory.

### Methods

#### `constructor()`
Instantiates all sub-modules and calls `setupIpcHandlers()`.

#### `setupIpcHandlers()`
Registers all `ipcMain.handle` listeners covering: UI open/close, panel resize, directory selection, file operations, request CRUD, environment CRUD, collection management, state persistence, git operations, and export/import.

#### `handleBrunoOpen(event)` / `handleBrunoClose(event)`
Delegates to `BrunoUI.open` / `BrunoUI.close`.
- **Outputs:** `Promise<boolean>`

#### `handleSelectDirectory()`
Shows a native directory-picker dialog.
- **Outputs:** `Promise<string|null>`

#### `handleSaveFile(event, filePath, data)` / `handleLoadFile(event, filePath)` / `handleDeleteFile(event, filePath)`
Generic file write / read+parse / delete operations.
- **Outputs:** `Promise<boolean>` or `Promise<object>`

#### `handleCreateRequest(event, collectionPath, name)`
Creates a new in-memory request object (no disk write).
- **Outputs:** `Promise<object>`

#### `handleListRequests(event, collectionPath)`
Recursively lists all request `.json` files under a collection.
- **Outputs:** `Promise<Array<{filename, folder, path}>>`

#### `handleSaveRequest(event, collectionPath, filename, data)` / `handleLoadRequest(event, filepath)` / `handleDeleteRequest(event, collectionPath, filename)`
Request file CRUD.

#### `handleCreateEnvironment` / `handleListEnvironments` / `handleLoadEnvironment` / `handleLoadEnvironmentFull` / `handleSaveEnvironment` / `handleDeleteEnvironment`
Environment file CRUD. See `environments.js` for signatures.

#### `handleListCollections(event)` / `handleCreateCollection(event)` / `handleInitCollection(event, dirPath)`
Collection management via directory-picker dialogs and `initCollection`.

#### `handleGetActiveEnvironment(event, dirPath)` / `handleSetActiveEnvironment(event, dirPath, envName)`
Read/write the active environment in `bruno.json`.

#### `handleSaveState(event, state)` / `handleLoadState()`
Persist and restore Bruno UI state to `bruno-state.json`.
- **Outputs:** `Promise<boolean>` / `Promise<object|null>`

#### `handleGitInit` / `handleIsGitRepo` / `handleGitStatus` / `handleCreateGitignore`
Git operations. See `git.js` for signatures.

#### `handleExportCollection(event, collectionPath)` / `handleImportCollection(event)`
Export collection to object / import from file picker.

### Key Variables

| Name | Type | Purpose |
|---|---|---|
| `STATE_FILE` | `string` | Absolute path to `bruno-state.json` in user-data directory |
| `this.ui` | `BrunoUI` | Manages the Bruno `WebContentsView` panel |
| `this.requests` | `RequestManager` | Request CRUD on disk |
| `this.environments` | `EnvironmentManager` | Environment CRUD on disk |
| `this.files` | `object` | Module-level file utilities |
| `this.collections` | `object` | Module-level collection utilities |
| `this.git` | `object` | Module-level git utilities |
| `this.exportImport` | `object` | Module-level export/import functions |

---

## requests.js

### Purpose

Provides the `RequestManager` class for all CRUD operations on Bruno HTTP request files. Each request is stored as a `.json` file inside a collection directory, optionally inside subdirectories (folders). Used by `Features/Bruno/index.js`.

### Methods

#### `createRequest(collectionPath, requestName)`
Builds a new request data object in memory. No file is written.
- **Inputs:** `collectionPath` — `string`; `requestName` — `string`
- **Outputs:** `object` — `{ filename, name, method: 'GET', url, params, headers, body, auth, script, assert, docs }`

#### `saveRequest(collectionPath, filename, requestData)`
Writes request data to `{collectionPath}/{filename}.json`. Creates intermediate directories as needed.
- **Inputs:** `collectionPath` — `string`; `filename` — `string` (may include subfolder segments); `requestData` — `object`
- **Outputs:** `boolean` — `true` on success; throws on failure

#### `loadRequest(filepath)`
Reads and parses a single request file.
- **Inputs:** `filepath` — `string`
- **Outputs:** `object` — throws on failure

#### `listRequests(collectionPath)`
Recursively scans a collection directory. Skips `environments/`, `bruno.json`, and non-`.json` files.
- **Inputs:** `collectionPath` — `string`
- **Outputs:** `Array<{ filename, folder: string|null, path }>` — empty array on error

#### `deleteRequest(collectionPath, filename)`
Deletes a request file. Silently succeeds if absent.
- **Inputs:** `collectionPath` — `string`; `filename` — `string`
- **Outputs:** `boolean` — `true` on success; throws on error

---

## ui.js

### Purpose

Provides the `BrunoUI` class, which manages the lifecycle and sizing of the Bruno side-panel `WebContentsView`. Handles opening (creating on first use), closing (destroying and removing), and drag-to-resize. Keeps the panel correctly sized when the parent window is resized.

### Methods

#### `constructor()`
Initialises `resizing` `WeakMap` for per-window drag state.

#### `getBrunoBounds(win, ratio)`
Calculates the pixel bounds for the panel given a window and a width ratio.
- **Inputs:** `win` — `BrowserWindow`; `ratio` — `number` (0.0–1.0)
- **Outputs:** `{ x, y, width, height }` — panel flush with right edge, starting at `topOffset` 104 px

#### `open(event)`
Shows the Bruno panel. Creates the `WebContentsView` on first use, attaches a `resize` listener. Updates bounds if already open.
- **Inputs:** `event` — Electron IPC event
- **Outputs:** `boolean` — `true` on success

#### `close(event)`
Hides and destroys the Bruno panel. Unregisters shortcuts, removes resize listener, resets `brunoWidth` to `0`.
- **Inputs:** `event` — IPC event or object with `.sender`; null-safe
- **Outputs:** `boolean`

#### `startResize(event, startX)`
Records mouse x and current ratio at drag start in `resizing`.
- **Inputs:** `event` — IPC event; `startX` — `number`
- **Outputs:** none

#### `doResize(event, currentX)`
Updates panel width in real time. Clamps ratio to [0.20, 0.75].
- **Inputs:** `event` — IPC event; `currentX` — `number`
- **Outputs:** none

#### `endResize(event)`
Cleans up drag state in `resizing`.
- **Inputs:** `event` — IPC event
- **Outputs:** none

### Key Variables

| Name | Type | Purpose |
|---|---|---|
| `resizing` | `WeakMap<windowData, {startX, startRatio}>` | Per-window resize drag state |
| `topOffset` | `number` (104) | Pixel distance from top of content area where panel begins |
| `windowData.brunoRatio` | `number` | Fraction of window width for the panel; defaults to `0.42`; clamped to [0.20, 0.75] |
| `windowData.bruno` | `WebContentsView\|null` | The panel view; `null` when closed |
| `windowData.brunoResizeHandler` | `function\|null` | Window `resize` listener; stored for cleanup on close |
