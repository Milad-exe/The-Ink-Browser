/**
 * One-off codemod: give every silent `catch { }` somewhere to speak.
 *
 * The empty catch is usually the RIGHT call in a browser — one broken feature
 * must not take the window down — but it left no trace at all, so a
 * half-working feature was undebuggable. This rewrites each empty catch to log
 * at `debug` (off unless NORTHSTAR_LOG_LEVEL=debug, so normal runs stay silent
 * and cost nothing) tagged with the file and the enclosing function, which is
 * the context you actually want when reading a log.
 *
 * Deliberately NOT touched:
 *   preload/*   — those run in arbitrary web pages; logging from there would be
 *                 noisy and would record page-context failures that are not ours
 *   scripts/, tests/ — build/test tooling, not the app
 *
 * CAUTION when re-running: the regex is textual, so an empty catch inside a
 * STRING (page script handed to executeJavaScript) or inside a comment gets
 * rewritten too — that is page-side code and must stay as it is. The first run
 * hit five of those, so `insideString()` now skips them and the checker at the
 * end of this file fails the run if any slip through.
 *
 * Run: node scripts/log-empty-catches.js [--dry]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INCLUDE = ['features', 'ipc', 'renderer', 'main.js'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'assets', 'styles']);
const SKIP_FILES = new Set([
    'renderer/lib/util.js', // pure helpers; their catches are control flow
    'features/log.js',      // the logger cannot log its own failures
]);

/** Is `offset` inside a quoted string on its line? (injected page scripts) */
function insideString(src, offset) {
    const lineStart = src.lastIndexOf('\n', offset) + 1;
    const before = src.slice(lineStart, offset);
    const singles = (before.match(/(?<!\\)'/g) || []).length;
    const backticks = (before.match(/(?<!\\)`/g) || []).length;
    const doubles = (before.match(/(?<!\\)"/g) || []).length;
    return singles % 2 === 1 || backticks % 2 === 1 || doubles % 2 === 1;
}

const dry = process.argv.includes('--dry');

function walk(target, out = []) {
    const abs = path.join(ROOT, target);
    if (fs.statSync(abs).isFile()) {
        if (abs.endsWith('.js'))
            out.push(target);
        return out;
    }
    for (const entry of fs.readdirSync(abs)) {
        if (SKIP_DIRS.has(entry))
            continue;
        walk(path.join(target, entry), out);
    }
    return out;
}

/** Nearest enclosing function-ish name above `index`, for log context. */
function contextName(src, index) {
    const before = src.slice(0, index);
    const patterns = [
        /(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
        /(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/g,
        /(?:^|\n)\s{4}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g, // class methods
        /(?:^|\n)\s*ipcMain\.(?:handle|on)\(\s*['"]([^'"]+)['"]/g,
    ];
    let best = { pos: -1, name: null };
    for (const re of patterns) {
        let m;
        while ((m = re.exec(before)) !== null) {
            if (m.index > best.pos)
                best = { pos: m.index, name: m[1] };
        }
    }
    return best.name;
}

const EMPTY_CATCH = /catch\s*(?:\(\s*([\w$]*)\s*\))?\s*\{\s*\}/g;

let filesChanged = 0;
let total = 0;
for (const rel of INCLUDE.flatMap(t => walk(t))) {
    if (SKIP_FILES.has(rel))
        continue;
    const abs = path.join(ROOT, rel);
    let src = fs.readFileSync(abs, 'utf8');
    if (!EMPTY_CATCH.test(src))
        continue;
    EMPTY_CATCH.lastIndex = 0;

    const isRenderer = rel.startsWith('renderer' + path.sep);
    const scope = path.basename(rel, '.js').replace(/^index$/, path.basename(path.dirname(rel)));
    let count = 0;
    src = src.replace(EMPTY_CATCH, (match, binding, offset) => {
        // A catch inside a string is page-side code handed to
        // executeJavaScript — rewriting it breaks the page script.
        if (insideString(src, offset))
            return match;
        count++;
        const name = contextName(src, offset) || scope;
        const bind = binding || 'e';
        const call = isRenderer
            ? `window.northstarLog?.debug('${scope}', '${name}: ' + ${bind})`
            : `log.debug('${scope}', '${name}', ${bind})`;
        return `catch (${bind}) { ${call}; }`;
    });

    // Main-process files need the logger in scope.
    if (!isRenderer && !/require\(['"](?:\.\.?\/)+(?:features\/)?log['"]\)/.test(src)) {
        const depth = rel.split(path.sep).length - 1;
        const req = depth === 0 ? './features/log' : (rel.startsWith('features') ? './'.padEnd(1) : '../features/');
        let spec;
        if (rel.startsWith('features' + path.sep)) {
            const sub = rel.split(path.sep).length - 2; // features/x.js → 0, features/tabs/x.js → 1
            spec = sub > 0 ? '../'.repeat(sub) + '../features/log' : './log';
            if (sub > 0)
                spec = '../log';
        }
        else if (rel.startsWith('ipc' + path.sep))
            spec = '../features/log';
        else
            spec = './features/log';
        const line = `const log = require('${spec}');\n`;
        // After the file's own leading comment/'use strict', before other code.
        const m = /^(?:\/\*[\s\S]*?\*\/\s*|\/\/.*\n|\s*'use strict';\n)*/.exec(src);
        const at = m ? m[0].length : 0;
        src = src.slice(0, at) + line + src.slice(at);
    }

    total += count;
    filesChanged++;
    if (!dry)
        fs.writeFileSync(abs, src);
    console.log(`${String(count).padStart(4)}  ${rel}`);
}
console.log(`\n${dry ? 'would rewrite' : 'rewrote'} ${total} empty catches in ${filesChanged} files`);

// A rewrite that landed inside a string literal is a bug, not a log line: fail
// loudly rather than leaving a page script that throws on load.
let suspect = 0;
for (const rel of INCLUDE.flatMap(t => walk(t))) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    src.split('\n').forEach((line, i) => {
        const at = line.indexOf('log.debug(') >= 0 ? line.indexOf('log.debug(') : line.indexOf('northstarLog?.debug(');
        if (at < 0)
            return;
        const before = line.slice(0, at);
        if (before.split("'").length % 2 === 0 || before.split('`').length % 2 === 0) {
            console.error(`  !! inside a string: ${rel}:${i + 1}`);
            suspect++;
        }
    });
}
if (suspect) {
    console.error(`\n${suspect} rewrite(s) landed inside string literals — revert those lines by hand.`);
    process.exitCode = 1;
}
