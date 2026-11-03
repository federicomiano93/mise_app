// The hook that keeps scripts off the real database, .claude/hooks/guard-admin-sdk.mjs. It must refuse
// what would reach production by accident and, just as much, never stop a command that only TALKS
// about it (a commit message, a grep): a refusal for nothing stops unattended work.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hookDecision } from '../.claude/hooks/guard-admin-sdk.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// In two pieces, so this file never looks like a script that loads the SDK.
const SDK = ['firebase', 'admin'].join('-');
const PY_SDK = ['firebase', 'admin'].join('_');
const HELPER = { agent_id: 'a1b2c3', agent_type: 'implementer' };

const dir = mkdtempSync(path.join(tmpdir(), 'guard-admin-sdk-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const forward = dir.replace(/\\/g, '/');

const write = (name, text) => {
  const file = path.join(dir, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
};
write('seed.mjs', `import admin from '${SDK}';\nadmin.initializeApp();\n`);
write('sub/seed2.mjs', `const admin = require('${SDK}');\n`);
write('via-import.mjs', `import './lib/db.mjs';\n`);
write('lib/db.mjs', `export const app = await import('${SDK}/app');\n`);
write('users.mjs', `import { getAuth } from '${SDK}/auth';\n`);
write('self-pinned.mjs', `process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';\nconst admin = require('${SDK}');\n`);
write('plain.mjs', `console.log('hello');\n`);
write('mention.mjs', `// this one does not use ${SDK}\nconst key = 'bakery-${SDK}sdk-ab12c.json';\n`);
write('seed.py', `import ${PY_SDK}\n`);
write('cloud.py', `from google.cloud import firestore\n`);
write('rest.mjs', `await fetch('https://firestore.googleapis.com/v1/projects/x');\n`);
write('only-comments.mjs', `// import admin from '${SDK}';\n  // once called firestore.googleapis.com\n# from ${PY_SDK} import auth\n/* import admin from '${SDK}';\n * import admin from '${SDK}';\n */\nconsole.log(1);\n`);
write('seed.test.mjs', `import admin from '${SDK}';\n`);
write('rest.test.mjs', `await fetch('https://firestore.googleapis.com/v1/projects/x');\n`);
write('both.mjs', `import admin from '${SDK}';\nawait fetch('https://firestore.googleapis.com/v1/projects/x');\n`);
write('page.html', '<meta content="connect-src https://firestore.googleapis.com">\n');
write('deps.mjs', `const deps = { '${SDK}': '13.0.0' };\nconsole.log(deps['${SDK}']);\n`);
write('patches-js.py', `old = "const a = require('${SDK}')"\n`);
write('documents-pin.mjs', `/*\nprocess.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';\n*/\nimport a from '${SDK}';\n`);
write('prints-pin.mjs', `import a from '${SDK}';\nconsole.log("process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'"); // process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'\n`);
write('block-pin.mjs', `import a from '${SDK}';\nif (process.argv[2] === 'test') {\n  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';\n}\n`);
write('doc-pin.py', `"""\nos.environ['FIRESTORE_EMULATOR_HOST'] = '127.0.0.1:8080'\n"""\nimport ${PY_SDK}\n`);
write('own-pin.py', `os.environ['FIRESTORE_EMULATOR_HOST'] = '127.0.0.1:8080'\nimport ${PY_SDK}\n`);
write('run.sh', 'node seed.mjs\n');
write('dir-entry/index.js', `import a from '${SDK}';\n`);
write('own-package.mjs', `console.log(require('./functions/node_modules/${SDK}/package.json').version);\n`);
write('comment-first.mjs', `/* seed */ import a from '${SDK}';\n`);
write('conditional-pin.mjs', `if (process.argv[2] === 'test') process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';\nimport('${SDK}');\n`);
write('by-create-require.mjs', `import { createRequire } from 'node:module';\nconst req = createRequire(process.cwd() + '/x.js');\nreq('${SDK}/firestore');\n`);
write('by-path.mjs', `import a from '../functions/node_modules/${SDK}/lib/index.js';\n`);
write('by-cwd.mjs', `await import(process.cwd() + '/functions/node_modules/${SDK}/lib/index.js');\n`);
write('google-cloud.mjs', `import { Firestore } from '@google-cloud/firestore';\n`);
write('old-auth.mjs', `process.env.X = 1;\nconst admin = require('${SDK}');\nadmin.auth().listUsers();\n`);
write('cloud-from.py', 'from google.cloud.firestore import Client\n');
write('cloud-direct.py', 'import google.cloud.firestore\n');
write('cloud-v1.py', 'from google.cloud.firestore_v1 import Client\n');
write('cloud-bracket.py', 'from google.cloud import (\n  firestore,\n)\n');
write('py-try.py', `try: import ${PY_SDK}\nexcept Exception: pass\n`);
write('cloud-list.py', 'from google.cloud import storage, firestore\n');
write('py-list.py', `import os, ${PY_SDK}\n`);
write('py-semi.py', `import os; from ${PY_SDK} import firestore\n`);

const ask =(command, extra = {}) => hookDecision({ tool_name: 'Bash', tool_input: { command }, cwd: dir, ...extra });

function hookCommand() {
  const settings = JSON.parse(readFileSync(path.join(ROOT, '.claude/settings.json'), 'utf8'));
  const entry = settings.hooks.PreToolUse.find((e) => e.matcher === 'Bash|PowerShell');
  return entry.hooks.find((h) => h.command.includes('guard-admin-sdk')).command;
}

function refused(command, extra) {
  const decision = ask(command, extra);
  assert.equal(decision?.permissionDecision, 'deny', `should be refused: ${command}`);
  return decision.permissionDecisionReason;
}
function passes(command, extra) {
  assert.equal(ask(command, extra), null, `should pass: ${command}`);
}

test('an Admin SDK script with no emulator is refused, and the refusal says what to do', () => {
  const why = refused('node seed.mjs');
  assert.match(why, /FIRESTORE_EMULATOR_HOST=127\.0\.0\.1:8080/);
  assert.match(why, /FIREBASE_AUTH_EMULATOR_HOST=127\.0\.0\.1:9099/);
  assert.match(why, /firestore-write-guard/);
  assert.match(why, /MISE_REAL_DATA=1/);
});

test('every way of running the script counts', () => {
  for (const command of [
    'node --no-warnings seed.mjs',
    `node "${path.join(dir, 'seed.mjs')}"`,
    'npx --no-install tsx seed.mjs',
    '& "C:\\Program Files\\nodejs\\node.exe" seed.mjs',
    'cd sub && node seed2.mjs',
    'cd sub; node seed2.mjs',
    'Set-Location sub; node seed2.mjs',
    `D="${forward}"; node "$D/seed.mjs"`,
    `$D = "${forward}"; node "$D/seed.mjs"`,
    `export D="${forward}"; node "\${D}/seed.mjs"`,
    `D="${forward}"; cd "$D/sub"; node seed2.mjs`,
    'env NODE_ENV=test node seed.mjs',
    'NODE_ENV=test node seed.mjs',
    'timeout 30 node seed.mjs',
    'node seed.mjs 2>&1 | tail -n 5',
    'git status\nnode seed.mjs',
    'bash -c "node seed.mjs"',
    'powershell -NoProfile -Command "node seed.mjs"',
    'cmd /c node seed.mjs',
    'node --import ./seed.mjs plain.mjs',
    'if (1) { node seed.mjs }',
    'node seed',
  ]) refused(command);
});

test('a file the script imports directly counts', () => {
  refused('node via-import.mjs');
});

test('code given on the command line counts', () => {
  for (const command of [
    `node -e "require('${SDK}')"`,
    `node --eval "import('${SDK}/firestore')"`,
    `node --eval="require('${SDK}')"`,
    `node --input-type=module -e "import a from '${SDK}'"`,
    `node -e 'require("${SDK}")'`,
    `node -e "require(\\"${SDK}\\")"`,
    `node <<'EOF'\nimport a from '${SDK}';\nEOF`,
    `node - <<EOF\nconst a = require('${SDK}');\nEOF`,
    `echo "require('${SDK}')" | node`,
    `echo "require('${SDK}')" | node -`,
    `node <<< "require('${SDK}')"`,
    `@'\nimport a from '${SDK}';\n'@ | node --input-type=module -`,
  ]) refused(command);
});

test('a script written and run by the same command counts', () => {
  for (const command of [
    `cat > fresh.mjs <<'EOF'\nimport a from '${SDK}';\nEOF\nnode fresh.mjs`,
    `echo "require('${SDK}')" > fresh2.mjs && node fresh2.mjs`,
    // plain.mjs is harmless on disk, and this command is about to overwrite it.
    `cat > plain.mjs <<'EOF'\nimport a from '${SDK}';\nEOF\nnode plain.mjs`,
  ]) refused(command);
});

test('Python counts', () => {
  for (const command of [
    'python seed.py',
    'python3 -I cloud.py',
    `python -c "import ${PY_SDK}"`,
    `python - <<'EOF'\nfrom ${PY_SDK} import firestore\nEOF`,
  ]) refused(command);
});

test('the firebase and gcloud commands that change data are refused; the others pass', () => {
  for (const command of [
    'firebase firestore:delete --all-collections --project bakery-app-ebf90',
    'npx firebase firestore:bulkdelete x',
    'npx firebase-tools@15.34.2 firestore:delete --all-collections',
    'firebase firestore:databases:delete x',
    'node node_modules/firebase-tools/lib/bin/firebase.js firestore:delete x',
    'gcloud firestore import gs://x',
    'gcloud firestore bulk-delete --collection-ids=x',
    'gcloud --project bakery-app-ebf90 firestore import gs://x',
    'gcloud -q firestore bulk-delete',
    'gcloud beta firestore import gs://x',
  ]) refused(command);
  for (const command of [
    'firebase emulators:start --only auth,firestore --project bakery-app-ebf90',
    'firebase projects:list',
    'firebase firestore:indexes',
    'firebase firestore:databases:list',
    'gcloud firestore indexes composite list',
    'gcloud firestore databases describe',
    'node js/firebase.js',
  ]) passes(command);
});

test('an emulator set for the program that runs lets it through', () => {
  for (const command of [
    'FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node seed.mjs',
    'FIRESTORE_EMULATOR_HOST=localhost:8080 node seed.mjs',
    'FIRESTORE_EMULATOR_HOST="[::1]:8080" node seed.mjs',
    'export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080; node seed.mjs',
    'H=127.0.0.1:8080; export FIRESTORE_EMULATOR_HOST=$H; node seed.mjs',
    'FIRESTORE_EMULATOR_HOST=127.0.0.1:8080; export FIRESTORE_EMULATOR_HOST; node seed.mjs',
    'H=127.0.0.1:8080; FIRESTORE_EMULATOR_HOST=$H node seed.mjs',
    "$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'; node seed.mjs",
    "$env:firestore_emulator_host = '127.0.0.1:8080'; node seed.mjs",
    'FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 bash -c "node seed.mjs"',
    'bash -c "FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node seed.mjs"',
    'cmd /c "set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080&& node seed.mjs"',
    'if true; then export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080; node seed.mjs; fi',
    'node self-pinned.mjs',
    'python own-pin.py',
  ]) passes(command);
  for (const command of ['node self-pinned.mjs', 'FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node seed.mjs']) passes(command, HELPER);
});

test('the emulator counts only for the program it was set for', () => {
  for (const command of [
    // On another program, in a comment, or only talked about: the second command reaches production.
    'FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node plain.mjs; node seed.mjs',
    'FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 git status && node seed.mjs',
    'FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 true; firebase firestore:delete x',
    '# FIRESTORE_EMULATOR_HOST=127.0.0.1:8080\nnode seed.mjs',
    'node seed.mjs # FIRESTORE_EMULATOR_HOST=127.0.0.1:8080',
    'echo FIRESTORE_EMULATOR_HOST=127.0.0.1:8080; node seed.mjs',
    'git commit -m "use FIRESTORE_EMULATOR_HOST=127.0.0.1:8080"; node seed.mjs',
    // Not exported, so the program never gets it; or taken away again.
    'FIRESTORE_EMULATOR_HOST=127.0.0.1:8080; node seed.mjs',
    'export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080; unset FIRESTORE_EMULATOR_HOST; node seed.mjs',
    "$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'; Remove-Item Env:FIRESTORE_EMULATOR_HOST; node seed.mjs",
    // A script that only documents, prints or conditionally sets it.
    'node documents-pin.mjs',
    'node prints-pin.mjs',
    'node conditional-pin.mjs',
    'node block-pin.mjs',
    'python doc-pin.py',
    // In bash and PowerShell `set` hands nothing on.
    'set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080; node seed.mjs',
    'set MISE_REAL_DATA=1; node seed.mjs',
  ]) {
    refused(command);
    assert.match(refused(command, HELPER), /helper never touches production/);
  }
});

test('a pin never excuses a firebase or gcloud write: those tools may ignore the variable', () => {
  for (const command of [
    'FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 firebase firestore:delete --all-collections',
    'FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 firebase firestore:bulkdelete x --force',
    'FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 gcloud firestore import gs://x',
  ]) assert.match(refused(command), /may ignore the variable/);
});

test('shell keywords do not hide the command', () => {
  for (const command of [
    'for i in 1 2; do node seed.mjs; done',
    'if true; then node seed.mjs; fi',
    'if true; then true; else node seed.mjs; fi',
    'if false; then true; elif node seed.mjs; then true; fi',
    'if node seed.mjs; then echo y; fi',
    'while node seed.mjs; do true; done',
    'until node seed.mjs; do true; done',
    '! node seed.mjs',
    'for c in a b; do firebase firestore:delete $c --force; done',
    'foreach ($x in 1,2) { node seed.mjs }',
  ]) refused(command);
});

test('a program or a host held in a variable is seen', () => {
  for (const command of [
    'G=gcloud; $G firestore bulk-delete',
    'G="C:/tools/gcloud.cmd"; "$G" firestore import gs://x',
    'N="C:/Program Files/nodejs/node.exe"; "$N" seed.mjs',
    '$node = "C:/Program Files/nodejs/node.exe"; & $node seed.mjs',
    `C="require('${SDK}')"; node -e "$C"`,
    `$c=@'\nrequire('${SDK}')\n'@\nnode -e $c`,
  ]) refused(command);
  for (const command of [
    'U=https://firestore.googleapis.com/v1/x; curl "$U"',
    'export U=https://firestore.googleapis.com/v1/x; curl -s $U',
    '$u = "https://firestore.googleapis.com/v1/x"; Invoke-RestMethod $u',
    'FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node both.mjs',
  ]) assert.match(refused(command, HELPER), /helper never touches production/);
});

test('the names that stand for the same thing all count', () => {
  for (const runner of ['nodejs', 'tsx', 'ts-node', 'bun', 'bun run', 'deno', 'deno run --allow-all', 'vite-node', 'npx tsx@4.19.2']) refused(`${runner} seed.mjs`);
  for (const runner of ['python', 'python3', 'py', 'python -X utf8', 'python -W ignore']) refused(`${runner} seed.py`);
  for (const shell of ['sh -c', 'zsh -c', 'bash -lc', 'bash -ce', 'pwsh -Command', 'pwsh -c', 'cmd /k']) refused(`${shell} "node seed.mjs"`);
  for (const wrapper of ['time', 'time -p', 'nohup', 'exec', 'command', 'call', 'start', 'start /b', 'nice', 'nice -n 10', 'winpty', 'cross-env A=1', 'env -u FOO', 'timeout -s KILL 30', 'npx -p tsx']) {
    refused(`${wrapper} node seed.mjs`);
  }
  for (const fetcher of ['wget', 'Invoke-WebRequest', 'Invoke-RestMethod', 'iwr', 'irm']) {
    assert.match(refused(`${fetcher} https://firestore.googleapis.com/v1/x`, HELPER), /helper never touches production/);
  }
  for (const file of ['google-cloud.mjs', 'comment-first.mjs', 'cloud-from.py', 'cloud-direct.py', 'cloud-v1.py', 'cloud-bracket.py', 'cloud-list.py', 'py-list.py', 'py-semi.py', 'py-try.py']) refused(`${file.endsWith('.py') ? 'python' : 'node'} ${file}`);
  // Auth through the old namespace needs the Auth emulator too.
  refused('FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node old-auth.mjs');
  passes('FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node old-auth.mjs');
});

test('the shapes a script really has to take outside functions/ count', () => {
  for (const command of [
    'node by-create-require.mjs',
    'node by-path.mjs',
    'node by-cwd.mjs',
    `node -e "require('./functions/node_modules/${SDK}')"`,
    `node -e "import a from'${SDK}'"`,
    `node -e "require('./seed.mjs')"`,
    `node <<'EOF'\nimport './seed.mjs';\nEOF`,
    'node --import=./seed.mjs plain.mjs',
    'node --require=./seed.mjs plain.mjs',
    'node --disable-warning X seed.mjs',
    'node --title x seed.mjs',
    'tsx --tsconfig plain.mjs seed.mjs',
    'node < seed.mjs',
    'node seed.mjs>out.txt',
    'node seed.mjs >> out.txt',
    'cat seed.mjs | node',
    'cat seed.mjs | node -',
    'eval "node seed.mjs"',
    'node "$PWD/seed.mjs"',
    'node "$(pwd)/seed.mjs"',
    'cmd /c "cd /d sub && node seed2.mjs"',
    `node <<\\E1\nrequire('${SDK}')\nE1`,
    `deno eval "import('${SDK}')"`,
    'node --import ./plain.mjs ./seed.mjs',
    'if true; then cd sub && node seed2.mjs; fi',
    'node - < seed.mjs',
    'python - < seed.py',
    `python -uc "import ${PY_SDK}"`,
    `node -e "require('..\\\\functions\\\\node_modules\\\\${SDK}\\\\lib\\\\index.js')"`,
    'bash run.sh',
    "bash <<'EOF'\nnode seed.mjs\nEOF",
    'echo "node seed.mjs" | bash',
    'iex "node seed.mjs"',
    'node dir-entry',
    'node --unknown-flag X seed.mjs',
    `echo "require('${SDK}')" | node --no-warnings`,
    `echo "require('${SDK}')" 2>&1 | node`,
  ]) refused(command);
});

test('the reader follows what a shell does with lines, quotes and brackets', () => {
  write('seed two.mjs', `import a from '${SDK}';\n`);
  for (const command of [
    'node \\\n  seed.mjs',
    'node \\\r\n  seed.mjs',
    'node `\n  seed.mjs',
    'node seed\\ two.mjs',
    'node "seed two.mjs"',
    `node<<'EOF'\nrequire('${SDK}')\nEOF`,
    `node<<<"require('${SDK}')"`,
    `node -e "require(\`"${SDK}\`")"`,
  ]) refused(command);
  for (const command of [
    'echo ${A:-a; node seed.mjs}',
    `@'\nnode seed.mjs\n'@ | Set-Content notes.txt`,
    'git commit -m "$(echo (a) b "; node seed.mjs; ")"',
    `echo "require('${SDK}')" || node`,
    `git commit -m "require('${SDK}')" | node plain.mjs`,
    `git commit -m "require('${SDK}')"; node - <<'EOF'\nconsole.log(1);\nEOF`,
    'git add seed.mjs; node plain.mjs',
    `git add plain.mjs && git commit -m "drop '${SDK}'" && node plain.mjs`,
    'gcloud firestore --help',
    'node own-package.mjs',
    'node missing.mjs > seed.mjs',
    'node missing.mjs>seed.mjs',
    'node missing.mjs >> seed.mjs',
  ]) passes(command);
  if (process.platform === 'win32') refused(`node "${forward.replace(/^([A-Za-z]):/, '/$1')}/seed.mjs"`);
});

test('what only names the SDK as a package, a target or a web address passes', () => {
  write('package-lock.json', JSON.stringify({ packages: { [`node_modules/${SDK}`]: { resolved: `https://registry.npmjs.org/${SDK}/-/${SDK}-13.0.0.tgz` } } }));
  for (const command of [
    'firebase deploy --only firestore:rules --project bakery-app-ebf90',
    `node -e "require('./package-lock.json')"`,
    `node -e "fetch('https://registry.npmjs.org/${SDK}/latest')"`,
  ]) passes(command);
});

test('a variable that points anywhere but this computer pins nothing', () => {
  for (const command of [
    'FIRESTORE_EMULATOR_HOST=10.0.0.5:8080 node seed.mjs',
    'FIRESTORE_EMULATOR_HOST=firestore.googleapis.com node seed.mjs',
    'FIRESTORE_EMULATOR_HOST=localhost.example.com:8080 node seed.mjs',
    'FIRESTORE_EMULATOR_HOST=127.0.0.1.example.com node seed.mjs',
    'MY_FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node seed.mjs',
  ]) refused(command);
});

test('a script that uses Auth needs the Auth emulator too', () => {
  refused('FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node users.mjs');
  passes('FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node users.mjs');
});

test('a command the emulator wraps passes', () => {
  passes('firebase emulators:exec --only firestore "node seed.mjs"');
  passes('npx firebase emulators:exec "node seed.mjs"');
  passes('npm run test:rules:emulated');
});

test('a command that only talks about it passes', () => {
  for (const command of [
    `grep -rn "${SDK}" functions/`,
    `git commit -m "node -e require('${SDK}') is now refused"`,
    `git commit -m "$(cat <<'EOF'\nrun "node seed.mjs; node -e require('${SDK}')" no more\nEOF\n)"`,
    `gh pr create --title x --body "import a from '${SDK}'; node seed.mjs"`,
    'cat seed.mjs',
    'echo node seed.mjs',
    'node --check seed.mjs',
    'node -c seed.mjs',
    'node --test seed.mjs',
    'node seed.test.mjs',
    'node mention.mjs',
    'node only-comments.mjs',
    'node plain.mjs',
    'node missing.mjs',
    'python -m http.server 5907 --bind 127.0.0.1',
    '# node seed.mjs',
    'node plain.mjs # ; node seed.mjs',
    'npm test',
    // What a script reads, as opposed to what it loads.
    `node -e "console.log(require('./functions/package.json').dependencies['${SDK}'])"`,
    'node deps.mjs',
    // Words after the code a runner runs are that code's own.
    'node -e "1" seed.mjs',
    'node - seed.mjs <<\'EOF\'\nconsole.log(1);\nEOF',
    'node plain.mjs seed.mjs',
    'node plain.mjs > seed.mjs',
    'node --env-file seed.mjs plain.mjs',
    // A heredoc or a message that only sits beside a harmless program.
    `cat > notes.md <<'EOF'\nimport a from '${SDK}';\nnode seed.mjs\nEOF\nnode plain.mjs`,
    `git commit -F - <<'EOF'\nimport a from '${SDK}';\nEOF\nnode plain.mjs`,
    `git commit -m "require('${SDK}')" && node plain.mjs`,
    `git commit -m "require('${SDK}')" && node missing.mjs`,
    // A message whose bracket closes nothing, in the $(cat <<'EOF' form every commit here uses.
    `git commit -m "$(cat <<'EOF'\nfix: a) run "x; node seed.mjs; y" no more\nEOF\n)"`,
    // A Python edit script may name the JS import, and a word a JS file names is no Python import.
    'python patches-js.py',
    // An odd program name must not reach Object.prototype.
    'constructor x',
    'toString x',
  ]) passes(command);
  // Harmless for the main conversation and for a helper alike.
  passes('node - seed.mjs <<\'EOF\'\nconsole.log(1);\nEOF', HELPER);
  passes('node - page.html <<\'EOF\'\nconsole.log(1);\nEOF', HELPER);
  passes('node rest.test.mjs', HELPER);
});

test('MISE_REAL_DATA=1 is the main conversation\'s way through, and nothing like it is', () => {
  passes('MISE_REAL_DATA=1 node seed.mjs');
  passes('$env:MISE_REAL_DATA = 1; node seed.mjs');
  passes('MISE_REAL_DATA=1 firebase firestore:delete x');
  refused('MISE_REAL_DATA=0 node seed.mjs');
  refused('MISE_REAL_DATA=10 node seed.mjs');
  refused('NOT_MISE_REAL_DATA=1 node seed.mjs');
  // It counts only when set for that program, like the emulator.
  refused('# MISE_REAL_DATA=1\nnode seed.mjs');
  refused('git commit -m "explain MISE_REAL_DATA=1" && node seed.mjs');
  refused('MISE_REAL_DATA=1 git status; node seed.mjs');
});

test('a helper is refused all of these, and the marker does not help it', () => {
  for (const command of [
    'node seed.mjs',
    'MISE_REAL_DATA=1 node seed.mjs',
    'MISE_REAL_DATA=1 firebase firestore:delete x',
    'node rest.mjs',
    'FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node rest.mjs',
    'gcloud auth print-access-token',
    'curl -X DELETE https://firestore.googleapis.com/v1/x',
    'curl -s "https://firestore.googleapis.com/v1/x"',
    `node -e "fetch('https://firestore.googleapis.com/v1/x')"`,
  ]) assert.match(refused(command, HELPER), /helper never touches production/);
});

test('a helper still works on the emulator and on everything else', () => {
  for (const command of [
    'FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node seed.mjs',
    'node plain.mjs',
    'node only-comments.mjs',
    'grep -rn firestore.googleapis.com scripts/',
    'npm test',
  ]) passes(command, HELPER);
});

test('the main conversation\'s own REST scripts pass: only a helper is refused them', () => {
  passes('node rest.mjs');
  passes('gcloud auth print-access-token');
  passes('curl https://firestore.googleapis.com/v1/x');
});

test('the PowerShell tool\'s input counts too', () => {
  assert.equal(hookDecision({ tool_name: 'PowerShell', tool_input: { script: 'node seed.mjs' }, cwd: dir })?.permissionDecision, 'deny');
});

test('odd input never throws', () => {
  for (const input of [undefined, null, {}, { tool_input: {} }, { tool_input: { command: 42 } }]) {
    assert.equal(hookDecision(input), null);
  }
  for (const command of ['node "seed.mjs', "node 'seed.mjs", 'node <<EOF', 'echo "$(', 'node ${', '@\'\nx', 'cd', 'node -e', '<<', '| node']) {
    assert.doesNotThrow(() => ask(command), command);
  }
});

test('the repository\'s own commands', () => {
  const inRepo = { cwd: ROOT };
  for (const file of readdirSync(path.join(ROOT, 'scripts')).filter((f) => f.endsWith('.mjs'))) {
    passes(`node scripts/${file}`, inRepo);
  }
  // The documented seed, for a helper too: it is what every driver starts from.
  passes('FIREBASE_PROJECT_ID=bakery-app-ebf90 node tests/rules/seed-emulator.mjs', inRepo);
  passes('FIREBASE_PROJECT_ID=bakery-app-ebf90 node tests/rules/seed-emulator.mjs', { ...inRepo, ...HELPER });
  // The guard names the module only as patterns, so reading its own source must not trip it.
  passes('node .claude/hooks/guard-admin-sdk.mjs', inRepo);
  passes('node scripts/build-bundles.mjs', { ...inRepo, ...HELPER });
  assert.match(refused('node scripts/read-feedback.mjs --delete x', { ...inRepo, ...HELPER }), /helper never touches production/);
});

test('it is wired, through the keeper, for both shells', () => {
  const command = hookCommand();
  assert.match(command, /run-guard\.mjs/);
  assert.match(command, /\$CLAUDE_PROJECT_DIR\/\.claude\/hooks\/guard-admin-sdk\.mjs/);
  assert.ok(existsSync(path.join(ROOT, '.claude/hooks/guard-admin-sdk.mjs')));
});

// The keeper makes a missing guard a question, on every command: a checkout on an older branch must
// not stop unattended work, including the very command that would switch it back.
test('a checkout without the guard file raises no objection', (t) => {
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  if (process.platform === 'win32' && !existsSync(bash)) return t.skip('no Git Bash here');
  const empty = path.join(dir, 'older-branch');
  mkdirSync(empty, { recursive: true });
  const run = spawnSync(bash, ['-c', hookCommand()], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status' } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: empty },
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, '');
});
