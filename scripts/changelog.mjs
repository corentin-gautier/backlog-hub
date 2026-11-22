// The next version and its CHANGELOG.md section, from the Conventional Commits since the last tag (vX.Y.Z).
// A breaking change (`feat!:` or a `BREAKING CHANGE:` footer) bumps the major (the minor before 1.0), `feat` the minor,
// `fix` and `perf` the patch; other types (docs, chore, style, build, refactor, test, ci) make no release.
//
//   node scripts/changelog.mjs            prints the next version and its notes (nothing written)
//   node scripts/changelog.mjs --write    also adds the section to CHANGELOG.md (release.sh sets the version with npm)
// Prints JSON: { version, notes } (version null when there is nothing to release).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const REPO = 'https://github.com/corentin-gautier/backlog-hub';
const SECTIONS = [['breaking', 'Breaking changes'], ['feat', 'Features'], ['fix', 'Fixes'], ['perf', 'Performance']];

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
let last = '';
try { last = git('describe', '--tags', '--abbrev=0', '--match', 'v*'); } catch (e) {}
const range = last ? [`${last}..HEAD`] : [];
const SEP = '\u001f';
const log = git('log', ...range, '--no-merges', `--format=%h${SEP}%s${SEP}%b\u001e`);

const groups = Object.fromEntries(SECTIONS.map(([key]) => [key, []]));
for (const entry of log.split('\u001e').map((e) => e.trim()).filter(Boolean)) {
	const [hash, subject, body = ''] = entry.split(SEP);
	const m = subject.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
	if (!m) continue;
	const [, type, scope, bang, text] = m;
	const line = `- ${scope ? `**${scope}:** ` : ''}${text} ([${hash}](${REPO}/commit/${hash}))`;
	const breaking = bang || /^BREAKING[ -]CHANGE:/m.test(body);
	if (breaking) groups.breaking.push(line);
	else if (groups[type]) groups[type].push(line);
}

const [major, minor, patch] = pkg.version.split('.').map(Number);
let version = null;
if (groups.breaking.length) version = major === 0 ? `0.${minor + 1}.0` : `${major + 1}.0.0`;
else if (groups.feat.length) version = `${major}.${minor + 1}.0`;
else if (groups.fix.length || groups.perf.length) version = `${major}.${minor}.${patch + 1}`;

const notes = SECTIONS.filter(([key]) => groups[key].length).map(([key, title]) => `### ${title}\n\n${groups[key].join('\n')}`).join('\n\n');

if (version && process.argv.includes('--write')) {
	const date = new Date().toISOString().slice(0, 10);
	const changelog = readFileSync('CHANGELOG.md', 'utf8');
	const section = `## ${version} — ${date}\n\n${notes}\n\n`;
	writeFileSync('CHANGELOG.md', changelog.replace(/^(# Changelog\n\n)/, `$1${section}`));
}
console.log(JSON.stringify({ version, notes }));
