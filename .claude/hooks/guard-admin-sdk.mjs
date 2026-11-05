#!/usr/bin/env node
// PreToolUse guard for Bash / PowerShell: refuses a command that would reach the REAL database by
// accident. Wired in .claude/settings.json through the global keeper ~/.claude/run-guard.mjs, which
// turns a crash or a timeout here into a question and writes every refusal to ~/claude-hook.log. A
// checkout without this file (an older branch) means no objection: the wiring looks before it runs.
//
// Why (2 Nov 2026): a script with firebase-admin bypasses firestore.rules, and without
// FIRESTORE_EMULATOR_HOST it writes to production with full power. The rule lived only in the
// firestore-write-guard skill, and a skill works only when it is loaded: 8 of 51 sessions that drove
// the app had loaded it. A rule that must hold every time belongs in a hook.
//
// What it refuses:
// - the Admin SDK with no emulator set for that very program: on its own part of the command, by an
//   earlier `export` or `$env:`, or by a statement of the script at the start of a line, unindented;
// - firebase's firestore: commands that change data and gcloud firestore, emulator or not, because
//   neither is sure to honour the variable;
// - inside a HELPER (a sub-agent), also gcloud's access token and anything it runs that names
//   firestore.googleapis.com: a helper never touches production, and MISE_REAL_DATA does not help it.
// MISE_REAL_DATA=1, on the command as above (a script cannot set it), is the main conversation's only
// way through, for a task that really IS production data (the skill says how). It is a refusal, never a question: he is often away
// (P10).
//
// ⚠️ A SEATBELT, NOT A LOCK: it stops an accident, not somebody trying, and only what a command runs
// directly plus one level of a JS script's relative imports (none of a Python script's). These pass
// unseen: `npm run …` and `npm exec`, `node --test` and a *.test.mjs (tests are pure by rule), `python
// -m`, a script that reaches the SDK two imports away, a path built at run time, a whole command or a
// loop's variable held in a variable (`CMD="node x"; $CMD`), code in backticks or in a double-quoted
// $( ), `find -exec`, Start-Process, NODE_OPTIONS, a `( … )` whose variables or `cd` are taken to last
// beyond it. It may refuse what merely names the SDK in a quoted string (`['a','firebase-admin']`): the
// refusal says how to go on. A command of many thousands of parts is too slow and becomes the keeper's
// question. The main conversation's REST scripts on its own gcloud login
// (scripts/read-*.mjs) pass on purpose.
//
// It reads the command with a small quote-aware reader instead of a regex over the text, because only
// the first word of each part says what runs: a commit message or a PR body that talks about all this
// must pass. (guard-dangerous-bash.mjs explains why a guard that must never MISS cannot work this way.
// A miss here costs what no guard at all cost until now.)

import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

// A quoted string that names the SDK, by package or by path: outside functions/ only a path or
// createRequire can even load it. A key (`deps['firebase-admin']`, `'firebase-admin': '1.0'`) loads nothing.
// Nor does a web address (`https://registry.npmjs.org/firebase-admin/-/…` in a lockfile).
// Nor does a package's own package.json. Bounded, so a long line stays quick.
const ADMIN_JS = /(?<!\[)['"`](?:(?:(?!:\/\/)[^'"`\n]){0,300}[\\/])?(?:firebase-admin|@google-cloud\/firestore)(?![^'"`\n]{0,300}\.json['"`])(?:[\\/][^'"`\n]{0,300})?['"`](?!\s*:)/;
const ADMIN_PY = /(?:^|;|:)[ \t]*(?:import[ \t][^\n;]*\b(?:firebase_admin|google\.cloud\.firestore(?:_v\d+)?)\b|from[ \t]+(?:firebase_admin|google\.cloud\.firestore(?:_v\d+)?)\b|from[ \t]+google\.cloud[ \t]+import[ \t]+(?:\([^)]*|[^\n;]*)\bfirestore\b)/m;
const ADMIN_AUTH = /firebase-admin\/auth|\badmin\.auth\(|firebase_admin\.auth\b|from\s+firebase_admin\s+import\s+[^\n]*\bauth\b/;
const REST = /firestore\.googleapis\.com/;
const RELATIVE_IMPORT = /(?:\bfrom\s{0,20}|\bimport\s{0,20}\(?\s{0,20}|\brequire\s{0,20}\(\s{0,20})['"`](\.{1,2}\/[^'"`]+)['"`]/g;
const HEREDOC = /^<<-?[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|\\?([\w.-]+))/;

const FIRESTORE_HOST = 'FIRESTORE_EMULATOR_HOST';
const AUTH_HOST = 'FIREBASE_AUTH_EMULATOR_HOST';
const REAL_DATA = 'MISE_REAL_DATA';
const LOOPBACK = '(?:127\\.0\\.0\\.1|localhost|\\[::1\\])(?::\\d+)?';
const IS_LOOPBACK = new RegExp(`^${LOOPBACK}$`);
// Only a statement at the start of a line, unindented: `if (x) process.env.… = …`, the body of a block
// or a function, a tip that prints it and a docstring that explains it pin nothing.
const scriptPins = (name) => new RegExp(
  `^(?:process\\.env\\.${name}|process\\.env\\[['"\`]${name}['"\`]\\]|os\\.environ\\[['"]${name}['"]\\])`
  + `\\s*(?:\\?\\?=|\\|\\|=|=)\\s*['"\`]${LOOPBACK}['"\`]`, 'm');

const JS_RUNNERS = new Set(['node', 'nodejs', 'tsx', 'ts-node', 'bun', 'deno', 'vite-node']);
const PY_RUNNERS = new Set(['python', 'python3', 'py']);
const POSIX_CODE_FLAG = /^-[a-zA-Z]*c[a-zA-Z]*$/;
const POWERSHELL_CODE_FLAG = /^-c(?:ommand)?$/i;
const SHELL_CODE_FLAG = new Map([['bash', POSIX_CODE_FLAG], ['sh', POSIX_CODE_FLAG], ['zsh', POSIX_CODE_FLAG],
  ['powershell', POWERSHELL_CODE_FLAG], ['pwsh', POWERSHELL_CODE_FLAG], ['cmd', /^\/[ck]$/i]]);
// What stands before the real command: tools that run the next word, and shell keywords.
const KEYWORDS = new Set(['then', 'do', 'else', 'elif', 'if', 'while', 'until', '!']);
const WRAPPERS = new Set([...KEYWORDS, 'env', 'time', 'nohup', 'exec', 'command', 'call', 'start', 'timeout', 'npx', 'nice', 'winpty', 'cross-env', 'xargs']);
const WRAPPER_TAKES_NEXT = new Map([['env', ['-u']], ['timeout', ['-s', '-k']], ['nice', ['-n']], ['xargs', ['-n', '-I', '-L', '-P']], ['npx', ['-p', '--package']]]);
const FETCHERS = new Set(['curl', 'wget', 'invoke-webrequest', 'invoke-restmethod', 'iwr', 'irm']);
const CHANGE_DIR = new Set(['cd', 'chdir', 'pushd', 'set-location', 'push-location', 'sl']);
const READERS = new Set(['cat', 'type', 'get-content', 'gc']);
const PRINTERS = new Set(['echo', 'printf', 'write-output']);
const WRITERS = new Set(['set-content', 'add-content', 'out-file', 'tee', 'tee-object', 'cp', 'mv', 'copy', 'move', 'copy-item', 'move-item']);
const EVALUATORS = new Set(['eval', 'iex', 'invoke-expression']);
// Flags that take the next word as code to load; the other flags' values are never opened (--env-file).
const LOADS_NEXT = new Set(['-r', '--require', '--import', '--loader', '--experimental-loader']);
const LOADS_JOINED = /^--(?:require|import|loader|experimental-loader)=/;
const TAKES_NEXT = new Set(['-C', '--conditions', '--env-file', '--env-file-if-exists', '--disable-warning', '--title', '--tsconfig']);
const PY_TAKES_NEXT = new Set(['-X', '-W']);
const LOOKS_AT_ONLY = new Set(['--test', '--check', '-c', '--version', '-v', '--help', '-h']);
const IS_TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_IMPORTS = 50;

// The parts of a command (split at ; && || | & a new line and brackets), each with its words, quotes
// resolved, whatever it receives as a heredoc or a here-string, and whether a pipe feeds it.
function partsOf(command) {
  const s = command;
  const parts = [];
  const newPart = (piped = false) => ({ words: [], stdin: '', piped });
  let part = newPart();
  let word = null;
  let wordIsStdin = false;
  let waiting = [];
  const add = (text) => { word = (word ?? '') + text; };
  const endWord = () => {
    if (word === null) return;
    if (wordIsStdin) { part.stdin += `${word}\n`; wordIsStdin = false; } else part.words.push(word);
    word = null;
  };
  const endPart = (piped) => {
    endWord();
    if (part.words.length || part.stdin) parts.push(part);
    part = newPart(piped);
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const next = s[i + 1];
    if (c === "'") {
      const close = s.indexOf("'", i + 1);
      const end = close < 0 ? s.length : close;
      add(s.slice(i + 1, end));
      i = end;
    } else if (c === '"') {
      const [text, end] = readDoubleQuoted(s, i);
      add(text);
      i = end;
    } else if (c === '@' && (word === null || word.endsWith('=')) && (next === "'" || next === '"') && /^\r?\n/.test(s.slice(i + 2, i + 4))) {
      // A PowerShell here-string: its body may hold any quote.
      const close = s.indexOf(`\n${next}@`, i + 2);
      const end = close < 0 ? s.length : close;
      add(s.slice(i + 2, end));
      i = close < 0 ? s.length : close + 2;
    } else if (c === '\\' && next === '\n') {
      i += 1;
    } else if (c === '\\' && next === '\r' && s[i + 2] === '\n') {
      i += 2;
    } else if (c === '\\' && next !== undefined && ' "\''.includes(next)) {
      add(next);
      i += 1;
    } else if (c === '`' && (next === '\n' || next === '\r')) {
      i += next === '\r' ? 2 : 1;
    } else if (c === '$' && next === '{') {
      const close = s.indexOf('}', i);
      const end = close < 0 ? s.length : close;
      add(s.slice(i, end + 1));
      i = end;
    } else if (c === '<' && next === '<' && s[i + 2] === '<') {
      endWord();
      wordIsStdin = true;
      i += 2;
    } else if (c === '<' && next === '<') {
      const m = HEREDOC.exec(s.slice(i));
      if (m) {
        endWord();
        waiting.push({ delimiter: m[1] || m[2] || m[3], owner: part });
        i += m[0].length - 1;
      } else add(c);
    } else if (c === '<' || c === '>') {
      // Its own word, so `node x.mjs>out.txt` still runs x.mjs and `node < x.mjs` is seen.
      endWord();
      part.words.push(c);
      if (next === '>') i += 1;
      if (s[i + 1] === '&') { add('&'); i += 1; }
    } else if (c === '#' && word === null) {
      const line = s.indexOf('\n', i);
      i = (line < 0 ? s.length : line) - 1;
    } else if (c === '\n') {
      endWord();
      for (const { delimiter, owner } of waiting) {
        const { body, end } = readHeredoc(s, i + 1, delimiter);
        owner.stdin += body;
        i = end;
      }
      waiting = [];
      endPart(false);
    } else if (';&|()'.includes(c) || ((c === '{' || c === '}') && word === null)) {
      if ((c === '|' || c === '&') && next === c) i += 1;
      endPart(c === '|' && next !== '|');
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endWord();
    } else {
      add(c);
    }
  }
  endPart(false);
  return parts;
}

// Inside double quotes a $( ) holds its own quotes, and a heredoc inside it holds anything at all: a
// commit message written as "$(cat <<'EOF' …)" is one word, however many quotes and brackets it has.
function readDoubleQuoted(s, start) {
  let text = '';
  let depth = 0;
  for (let i = start + 1; i < s.length; i++) {
    const c = s[i];
    if (depth === 0) {
      if (c === '"') return [text, i];
      if (c === '\\' && s[i + 1] !== undefined && '"\\$`'.includes(s[i + 1])) { text += s[++i]; continue; }
      if (c === '`' && s[i + 1] === '"') { text += '"'; i += 1; continue; }
      if (c === '$' && s[i + 1] === '(') { depth = 1; text += '$('; i += 1; continue; }
    } else if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    else if (c === '<' && s[i + 1] === '<') {
      const m = HEREDOC.exec(s.slice(i));
      const eol = m ? s.indexOf('\n', i) : -1;
      if (eol >= 0) {
        const { end } = readHeredoc(s, eol + 1, m[1] || m[2] || m[3]);
        text += s.slice(i, end + 1);
        i = end;
        continue;
      }
    }
    text += c;
  }
  return [text, s.length];
}

function readHeredoc(s, start, delimiter) {
  let body = '';
  let at = start;
  while (at < s.length) {
    const eol = s.indexOf('\n', at);
    const lineEnd = eol < 0 ? s.length : eol;
    const line = s.slice(at, lineEnd);
    if (line.trim() === delimiter) return { body, end: lineEnd - 1 };
    body += `${line}\n`;
    at = lineEnd + 1;
  }
  return { body, end: s.length };
}

const baseName = (word) => path.basename(String(word).replace(/\\/g, '/')).replace(/\.(?:exe|cmd)$/i, '').replace(/(.)@[^/]*$/, '$1').toLowerCase();

// The command a part really starts, past `X=1`, `env`, `npx --no-install`, `timeout 30`, `then`…, and
// the variables set for that command alone.
function commandOf(words) {
  let i = 0;
  const assigned = [];
  const pastAssignments = () => {
    while (i < words.length && /^[A-Za-z_]\w*=/.test(words[i])) {
      const at = words[i].indexOf('=');
      assigned.push([words[i].slice(0, at), words[i].slice(at + 1)]);
      i += 1;
    }
  };
  pastAssignments();
  while (i < words.length && WRAPPERS.has(baseName(words[i]))) {
    const takesNext = WRAPPER_TAKES_NEXT.get(baseName(words[i])) ?? [];
    i += 1;
    while (i < words.length && (/^-/.test(words[i]) || /^\/[a-zA-Z]$/.test(words[i]) || /^\d+[smhd]?$/.test(words[i]))) {
      if (takesNext.includes(words[i])) i += 1;
      i += 1;
    }
    pastAssignments();
  }
  return { name: i < words.length ? baseName(words[i]) : '', args: words.slice(i + 1), assigned };
}

// Keeps the working directory, the variables and what a later program inherits up to date, because
// `D="…"; cd "$D"; node x.mjs` is how a script is usually run here.
function follow(allWords, ctx) {
  let start = 0;
  while (KEYWORDS.has(allWords[start])) start += 1;
  const words = allWords.slice(start);
  const joined = words.join('');
  const powershellEnv = /^\$env:([A-Za-z_]\w*)=([\s\S]*)$/i.exec(words[0]?.startsWith('$') ? joined : '');
  if (powershellEnv) { ctx.env.set(powershellEnv[1].toUpperCase(), powershellEnv[2]); return; }
  const shellVar = /^\$([A-Za-z_]\w*)=([\s\S]*)$/.exec(words[0]?.startsWith('$') && words.length <= 3 ? joined : '');
  if (shellVar) { ctx.vars.set(shellVar[1], shellVar[2]); return; }
  const first = words[0]?.toLowerCase();
  // Only cmd's `set` hands a variable on; in bash and PowerShell it does not.
  if (first === 'export' || (first === 'set' && ctx.cmd)) {
    for (const w of words.slice(1)) {
      const at = w.indexOf('=');
      if (at > 0) {
        ctx.vars.set(w.slice(0, at), w.slice(at + 1));
        ctx.env.set(w.slice(0, at), w.slice(at + 1));
      } else if (ctx.vars.has(w)) ctx.env.set(w, ctx.vars.get(w));
    }
    return;
  }
  if (first === 'unset') { for (const w of words.slice(1)) { ctx.env.delete(w); ctx.vars.delete(w); } return; }
  if (first === 'remove-item' || first === 'ri') {
    for (const w of words.slice(1)) {
      const m = /^env:\\?([A-Za-z_]\w*)$/i.exec(w);
      if (m) ctx.env.delete(m[1].toUpperCase());
    }
    return;
  }
  if (words.length && words.every((w) => /^[A-Za-z_]\w*=/.test(w))) {
    for (const w of words) {
      const at = w.indexOf('=');
      ctx.vars.set(w.slice(0, at), w.slice(at + 1));
    }
    return;
  }
  if (CHANGE_DIR.has(baseName(words[0]))) {
    const target = words.slice(1).find((w) => !w.startsWith('-') && w.toLowerCase() !== '/d');
    if (target) ctx.cwd = pathFrom(target, ctx);
  }
}

const expand = (text, ctx) => text
  .replace(/\$\(pwd\)/g, () => ctx.cwd)
  .replace(/\$\{?(\w+)\}?/g, (whole, name) => {
    if (ctx.vars.has(name)) return ctx.vars.get(name);
    return name === 'PWD' ? ctx.cwd : whole;
  });

function pathFrom(word, ctx) {
  let p = expand(word, ctx);
  if (p === '~' || p.startsWith('~/')) p = path.join(homedir(), p.slice(1));
  if (process.platform === 'win32') p = p.replace(/^\/([a-zA-Z])\//, '$1:/');
  return path.resolve(ctx.cwd, p);
}

function readCode(file) {
  for (const ending of ['', '.mjs', '.js', '.cjs', '.ts', '.py', '/index.js', '/index.mjs']) {
    try {
      const candidate = file + ending;
      const info = statSync(candidate);
      if (info.isFile() && info.size <= MAX_FILE_BYTES) return { file: candidate, text: readFileSync(candidate, 'utf8') };
    } catch { /* not this one */ }
  }
  return null;
}

// A piece of code and the files it imports directly.
function withImports(code, dir) {
  let text = code;
  let count = 0;
  for (const m of code.matchAll(RELATIVE_IMPORT)) {
    if (++count > MAX_IMPORTS) break;
    if (m[1].endsWith('.json')) continue;
    const imported = readCode(path.resolve(dir, m[1]));
    if (imported) text += `\n${imported.text}`;
  }
  return text;
}

// What a runner's arguments will execute, or null when it only looks at the file (--test, --check) or
// runs a module by name (python -m). Words after the code it runs are that code's own arguments; a
// word that is no file may be some flag's value, so the search goes on past it.
function whatRuns(name, args, ctx) {
  const python = PY_RUNNERS.has(name);
  const run = { inline: [], files: [], fromStdin: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '>') break;
    if (python ? a === '-m' : LOOKS_AT_ONLY.has(a)) return null;
    if (python ? /^-[a-zA-Z]*c$/.test(a) : ['-e', '--eval', '-p', '--print', '-pe'].includes(a)) { run.inline.push(args[i + 1] ?? ''); break; }
    if (name === 'deno' && a === 'eval') { run.inline.push(args[i + 1] ?? ''); break; }
    if (!python && /^--(?:eval|print)=/.test(a)) { run.inline.push(a.slice(a.indexOf('=') + 1)); break; }
    if (a === '-') {
      run.fromStdin = true;
      if (args[i + 1] === '<' && args[i + 2] !== undefined) run.files.push(args[i + 2]);
      break;
    }
    if (!python && LOADS_NEXT.has(a)) { if (args[i + 1] !== undefined) run.files.push(args[++i]); continue; }
    if (!python && LOADS_JOINED.test(a)) { run.files.push(a.slice(a.indexOf('=') + 1)); continue; }
    if (python ? PY_TAKES_NEXT.has(a) : TAKES_NEXT.has(a)) { i += 1; continue; }
    if (a.startsWith('-') || a === '<') continue;
    if (IS_TEST_FILE.test(a)) return null;
    run.files.push(a);
    if (readCode(pathFrom(a, ctx))) break;
  }
  if (!run.inline.length && !run.files.length) run.fromStdin = true;
  return run;
}

// A whole line of comment is no code: a script that only says where production is must not stop a helper.
const withoutCommentLines = (text) => text.replace(/^[ \t]*(?:\/\/|#|\*|\/\*(?!.*\*\/[ \t]*\S)).*$/gm, '');
// For a pin only, where taking too much away errs on the safe side.
const withoutBlocks = (text) => text.replace(/\/\*[\s\S]*?\*\/|"""[\s\S]*?"""|'''[\s\S]*?'''/g, '');

// Reading only: everything else firebase does under firestore: changes something.
function isCliWrite(name, args) {
  if (name === 'firebase' || name === 'firebase-tools') {
    // `deploy --only firestore:rules` names a target, not a command, and the global guard asks about it.
    return args.some((a, i) => /^firestore:/.test(a) && args[i - 1] !== '--only'
      && !/(?::list|:get|^firestore:indexes|^firestore:locations)$/.test(a));
  }
  return name === 'gcloud' && args.includes('firestore') && !args.some((a) => a === 'list' || a === 'describe' || a === '--help');
}

// Code a program reads from a pipe: what the previous part printed, or the file it read out.
function pipedCode(previous, ctx) {
  if (!previous) return '';
  const { name, args } = commandOf(previous.words);
  const file = READERS.has(name) && args.find((a) => !a.startsWith('-'));
  const read = file && readCode(pathFrom(file, ctx));
  const printed = PRINTERS.has(name) ? args.join(' ') : previous.words.join(' ');
  return `${read ? read.text : printed}\n${previous.stdin}`;
}

// Everything in a command that would reach the real database, as { kind, what, code, text, env }.
function judge(command, ctx, depth = 0) {
  const found = [];
  let written = '';
  let previous = null;
  for (const raw of partsOf(command)) {
    const words = raw.words.map((w) => expand(w, ctx));
    const part = { ...raw, words };
    follow(words, ctx);
    const { name, args, assigned } = commandOf(words);
    const env = new Map([...ctx.env, ...assigned]);
    const note = (kind, what, code = '') => found.push({ kind, what, code, text: withoutCommentLines(code), env });
    const what = `\`${[name, ...args].join(' ').slice(0, 80)}\``;
    if (EVALUATORS.has(name) && depth < 2) {
      found.push(...judge(args.join(' '), { ...ctx, env }, depth + 1));
    } else if (SHELL_CODE_FLAG.has(name) && depth < 2) {
      const at = args.findIndex((a) => SHELL_CODE_FLAG.get(name).test(a));
      const inner = { ...ctx, env, cmd: name === 'cmd' };
      if (at >= 0) found.push(...judge(args.slice(at + 1).join(' '), inner, depth + 1));
      else {
        // A shell reading a script, a heredoc or a pipe.
        const file = args.find((a) => !a.startsWith('-') && a !== '<');
        const script = file && POSIX_CODE_FLAG === SHELL_CODE_FLAG.get(name) && readCode(pathFrom(file, ctx));
        found.push(...judge(`${script ? script.text : ''}\n${part.stdin}\n${part.piped ? pipedCode(previous, ctx) : ''}`, inner, depth + 1));
      }
    } else if (isCliWrite(name, args)) {
      note('cli', `\`${name} ${args.slice(0, 2).join(' ')}\``);
    } else if (name === 'gcloud' && args.includes('print-access-token')) {
      note('rest', 'gcloud\'s access token');
    } else if (FETCHERS.has(name) && args.some((a) => REST.test(a))) {
      note('rest', `\`${name}\` on firestore.googleapis.com`);
    } else if (JS_RUNNERS.has(name) && args.some((a) => /(?:^|[\\/])firebase(?:-tools)?(?:\.js)?$/.test(a)) && isCliWrite('firebase', args)) {
      note('cli', `\`firebase ${args.filter((a) => a.startsWith('firestore:')).join(' ')}\``);
    } else if (JS_RUNNERS.has(name) || PY_RUNNERS.has(name)) {
      const run = whatRuns(name, args, ctx);
      if (run) {
        const texts = run.inline.map((code) => withImports(code, ctx.cwd));
        if (run.fromStdin) {
          texts.push(withImports(part.stdin, ctx.cwd));
          if (part.piped) texts.push(withImports(pipedCode(previous, ctx), ctx.cwd));
        }
        for (const file of run.files) {
          const script = readCode(pathFrom(file, ctx));
          if (script) texts.push(withImports(script.text, path.dirname(script.file)));
          // An earlier part that writes a file of this name may be writing this very script.
          if (file && written.includes(path.basename(file))) texts.push(written);
        }
        const code = texts.join('\n');
        const text = withoutCommentLines(code);
        if ((PY_RUNNERS.has(name) ? ADMIN_PY : ADMIN_JS).test(text)) note('admin', what, code);
        if (REST.test(text)) note('rest', what, code);
      }
    }
    if (words.includes('>') || WRITERS.has(name) || ((JS_RUNNERS.has(name) || PY_RUNNERS.has(name)) && part.stdin)) {
      written += `${part.piped ? pipedCode(previous, ctx) : ''}${words.join(' ')}\n${part.stdin}\n`;
    }
    previous = part;
  }
  return found;
}

const isSet = (finding, name) => IS_LOOPBACK.test(finding.env.get(name) ?? '') || scriptPins(name).test(withoutBlocks(finding.code));

function isPinned(finding) {
  if (finding.kind !== 'admin' || !isSet(finding, FIRESTORE_HOST)) return false;
  return !ADMIN_AUTH.test(finding.text) || isSet(finding, AUTH_HOST);
}

const TEST_WAY = 'For a test, put the emulator on the same command: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 '
  + 'FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node <script> (PowerShell: $env:FIRESTORE_EMULATOR_HOST = \'127.0.0.1:8080\'; '
  + '$env:FIREBASE_AUTH_EMULATOR_HOST = \'127.0.0.1:9099\'; node <script>), or use the REST calls of tests/rules/seed-emulator.mjs.';
const CLI_WAY = 'A pin does not excuse it: these tools may ignore the variable. On the emulator, restart it to empty it.';

const refuse = (reason) => ({ permissionDecision: 'deny', permissionDecisionReason: `🛡️ ${reason}` });

export function hookDecision(input) {
  const toolInput = input?.tool_input || {};
  const command = toolInput.command ?? toolInput.script;
  if (typeof command !== 'string' || !command) return null;
  const helper = Boolean(input?.agent_id);
  const ctx = { cwd: input?.cwd || process.cwd(), vars: new Map(), env: new Map() };
  for (const finding of judge(command, ctx)) {
    const way = finding.kind === 'cli' ? CLI_WAY : TEST_WAY;
    if (finding.kind === 'rest') {
      if (helper) return refuse(`A helper never touches production (firestore-write-guard skill), and ${finding.what} would. Stop and report it.`);
    } else if (!isPinned(finding)) {
      if (helper) return refuse(`A helper never touches production (firestore-write-guard skill), and ${finding.what} would. ${way} Otherwise stop and report it.`);
      if (finding.env.get(REAL_DATA) !== '1') {
        return refuse(`${finding.what} would reach the REAL database, past every rule (firestore-write-guard skill). ${way} `
          + `Only if the task really IS production data (copy first, the smallest change, read back, report it): start the command with ${REAL_DATA}=1 (PowerShell: $env:${REAL_DATA} = 1;), never just to get past this refusal.`);
      }
    }
  }
  return null;
}
