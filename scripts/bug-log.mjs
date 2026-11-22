#!/usr/bin/env node
/**
 * Bug -> rule log: reads the one-file-per-entry folder `docs/bug-rules/` and
 * prints the log as a markdown table (sorted by date, then file name).
 *
 *   node scripts/bug-log.mjs            print the table to stdout
 *   node scripts/bug-log.mjs --check    only validate the entry files
 *   node scripts/bug-log.mjs <dir>      use another folder (tests, demos)
 *
 * The printed table is never committed and never checked in CI. Validation is
 * deliberately lenient: an entry file needs a name like
 * `YYYY-MM-DD-<slug>.md` and frontmatter with `date` and `layer`; every other
 * field is optional and unknown fields are allowed. Files whose name starts
 * with `_` (the template) and non-`.md` files are not entries.
 *
 * Zero dependencies: the frontmatter is a small YAML subset (`key: value`,
 * quoted strings, `[a, b]` and `- item` lists, `|`/`>` blocks, `#` comments),
 * parsed here. Scalars stay strings, so `layer: 01` is still `01`. A line of an
 * optional field the subset cannot read is only a warning, never a failure.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_DIR = fileURLToPath(
  new URL('../docs/bug-rules/', import.meta.url),
);
export const REPO_URL = 'https://github.com/meperdev/MeperPOS';

const FILE_NAME = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEY_LINE = /^([A-Za-z_][\w-]*)\s*:(.*)$/;
const LIST_ITEM = /^\s+-\s*(.*)$|^-\s+(.*)$/;

/** True for files that are log entries (not templates, not other files). */
export function isEntryFile(name) {
  return name.endsWith('.md') && !name.startsWith('_');
}

function stripComment(value) {
  // YAML: `#` starts a comment only at the start or after whitespace.
  const hash = value.search(/(^|\s)#/);
  return hash === -1 ? value : value.slice(0, hash);
}

// Index of the quote that closes the string opened at 0, or -1.
function closingQuote(value) {
  const quote = value[0];
  for (let i = 1; i < value.length; i += 1) {
    if (quote === '"' && value[i] === '\\') {
      i += 1;
    } else if (value[i] === quote) {
      if (quote === "'" && value[i + 1] === "'") i += 1;
      else return i;
    }
  }
  return -1;
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value.startsWith('"') || value.startsWith("'")) {
    const end = closingQuote(value);
    const rest = end === -1 ? '' : value.slice(end + 1);
    if (end === -1 || stripComment(rest).trim() !== '') {
      throw new Error(`unterminated or malformed quoted string: ${value}`);
    }
    return value.startsWith('"')
      ? JSON.parse(value.slice(0, end + 1))
      : value.slice(1, end).replace(/''/g, "'");
  }
  const plain = stripComment(value).trim();
  if (plain === '' || plain === '~' || plain === 'null') return null;
  return plain;
}

// `[a, "b, c", 'd #1']` -> ['a', 'b, c', 'd #1']; quotes count only at item start.
function parseFlowList(raw) {
  const value = raw.trim();
  const items = [];
  let i = 1;
  for (;;) {
    while (value[i] === ' ' || value[i] === '\t') i += 1;
    if (value[i] === ']' && items.length === 0) {
      i += 1;
      break;
    }
    if (i >= value.length) throw new Error(`unterminated list: ${value}`);
    let item;
    if (value[i] === '"' || value[i] === "'") {
      const end = closingQuote(value.slice(i));
      if (end === -1) throw new Error(`unterminated quoted list item: ${value}`);
      item = parseScalar(value.slice(i, i + end + 1));
      i += end + 1;
      while (value[i] === ' ' || value[i] === '\t') i += 1;
    } else {
      const stop = value.slice(i).search(/[,\]]/);
      if (stop === -1) throw new Error(`unterminated list: ${value}`);
      item = parseScalar(value.slice(i, i + stop));
      i += stop;
    }
    if (item != null) items.push(item);
    if (value[i] === ',') {
      i += 1;
      continue;
    }
    if (value[i] === ']') {
      i += 1;
      break;
    }
    throw new Error(`expected \`,\` or \`]\` in list: ${value}`);
  }
  if (stripComment(value.slice(i)).trim() !== '') {
    throw new Error(`unexpected text after the list: ${value}`);
  }
  return items;
}

function parseValue(raw) {
  return raw.trim().startsWith('[') ? parseFlowList(raw) : parseScalar(raw);
}

const isIndented = (line) => /^\s/.test(line);
const isSkippable = (line) => line.trim() === '' || line.trim().startsWith('#');

/**
 * Splits `---` frontmatter from the body and parses it.
 *
 * Returns `{ data, body, issues }`. Throws only when the `---` block itself is
 * missing. A line the subset cannot read is not fatal: it lands in `issues`
 * (`{ key, line, message }`, `key` null for an unreadable top-level line) and
 * the key keeps its raw text, so only `validateEntry` decides what blocks.
 * Indented content under a key that is not a list (a nested mapping, say) is
 * skipped; `|` and `>` block scalars are read.
 */
export function parseFrontmatter(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0].trim() !== '---') {
    throw new Error('the file must start with a `---` frontmatter block');
  }
  const close = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (close === -1) {
    throw new Error('the frontmatter block has no closing `---` line');
  }

  const data = {};
  const issues = [];
  let listKey = null;
  for (let i = 1; i < close; i += 1) {
    const line = lines[i];
    const lineNo = i + 1;
    if (isSkippable(line)) continue;

    const item = line.match(LIST_ITEM);
    if (item && listKey) {
      const raw = item[1] ?? item[2] ?? '';
      try {
        const value = parseScalar(raw);
        if (value != null) data[listKey].push(value);
      } catch (error) {
        data[listKey].push(raw.trim());
        issues.push({ key: listKey, line: lineNo, message: error.message });
      }
      continue;
    }
    if (isIndented(line)) continue; // nested content of the previous key

    listKey = null;
    const pair = line.match(KEY_LINE);
    if (!pair) {
      issues.push({
        key: null,
        line: lineNo,
        message: `not \`key: value\` or a \`- item\` under a key: ${line.trim()}`,
      });
      continue;
    }
    const [, key, rest] = pair;
    const head = stripComment(rest).trim();
    if (head === '') {
      // An empty value, the start of a block list, or a nested mapping.
      const next = lines.slice(i + 1, close).find((l) => !isSkippable(l));
      data[key] = next && next.match(LIST_ITEM) ? [] : null;
      if (data[key]) listKey = key;
      continue;
    }
    if (/^[|>][+-]?$/.test(head)) {
      const block = [];
      while (i + 1 < close && (lines[i + 1].trim() === '' || isIndented(lines[i + 1]))) {
        i += 1;
        block.push(lines[i].trim());
      }
      data[key] = block.join(head.startsWith('|') ? '\n' : ' ').trim() || null;
      continue;
    }
    try {
      data[key] = parseValue(rest);
    } catch (error) {
      data[key] = head;
      issues.push({ key, line: lineNo, message: error.message });
    }
  }

  return { data, body: lines.slice(close + 1).join('\n').trim(), issues };
}

const REQUIRED = new Set(['date', 'layer']);

/**
 * Checks one entry file. `problems` block (bad name, no `---` block, missing
 * or unreadable `date`/`layer`); `warnings` never do: they flag lines of
 * optional fields this small parser could not read, so they print as text.
 */
export function validateEntry(name, text) {
  const problems = [];
  const warnings = [];
  if (!FILE_NAME.test(name)) {
    problems.push(
      'rename it to `YYYY-MM-DD-<slug>.md` (lowercase letters, digits and hyphens), e.g. `2026-11-21-pr-392-csrf-cookie-ttl.md`',
    );
  }
  let parsed;
  try {
    parsed = parseFrontmatter(text);
  } catch (error) {
    problems.push(`fix the frontmatter: ${error.message}`);
    return { problems, warnings };
  }
  const { data, issues } = parsed;
  for (const issue of issues) {
    const where = `frontmatter line ${issue.line}`;
    if (REQUIRED.has(issue.key)) {
      problems.push(`fix \`${issue.key}\` (${where}): ${issue.message}`);
    } else {
      warnings.push(`${where} kept as plain text: ${issue.message}`);
    }
  }
  const failed = new Set(issues.map((issue) => issue.key));
  if (!failed.has('date')) {
    if (data.date == null || data.date === '') {
      problems.push('add `date: YYYY-MM-DD` to the frontmatter');
    } else if (typeof data.date !== 'string' || !DATE.test(data.date)) {
      problems.push(
        `\`date\` must be YYYY-MM-DD, got ${JSON.stringify(data.date)}`,
      );
    }
  }
  if (!failed.has('layer') && (data.layer == null || data.layer === '' || Array.isArray(data.layer))) {
    problems.push(
      'add `layer: "02"` to the frontmatter (01, 02, 03 or a combination like "01+02")',
    );
  }
  return { problems, warnings };
}

/**
 * Reads every entry file in `dir`.
 * Returns `{ entries, errors, warnings }`, each message naming the file.
 * Only `errors` fail a check.
 */
export function readEntries(dir = DEFAULT_DIR) {
  const entries = [];
  const errors = [];
  const warnings = [];
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((dirent) => dirent.isFile() && isEntryFile(dirent.name))
    .map((dirent) => dirent.name)
    .sort();

  for (const name of names) {
    const file = join(dir, name);
    const shown = relative(process.cwd(), file) || file;
    const text = readFileSync(file, 'utf8');
    const { problems, warnings: notes } = validateEntry(name, text);
    for (const note of notes) warnings.push(`${shown}: ${note}`);
    if (problems.length > 0) {
      for (const problem of problems) errors.push(`${shown}: ${problem}`);
      continue;
    }
    const { data, body } = parseFrontmatter(text);
    entries.push({ file: name, data, body });
  }

  entries.sort(
    (a, b) =>
      a.data.date.localeCompare(b.data.date) || a.file.localeCompare(b.file),
  );
  return { entries, errors, warnings };
}

function cell(value) {
  return String(value ?? '')
    .replace(/\s*\r?\n\s*/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function asList(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value.filter((v) => v != null) : [value];
}

// `path (note)` -> `` `path` (note) ``, so annotations stay outside the code span.
function codePath(item) {
  const match = String(item).match(/^(\S+)(\s+.*)?$/);
  return match ? `\`${match[1]}\`${match[2] ?? ''}` : String(item);
}

function prLink(pr) {
  if (pr == null || pr === '' || /^tbd$/i.test(String(pr))) return '';
  const number = String(pr).replace(/^#/, '');
  return /^\d+$/.test(number) ? `[#${number}](${REPO_URL}/pull/${number})` : number;
}

/** The log as a markdown table, one row per entry, in the given order. */
export function renderTable(entries) {
  const rows = [
    '| Date | Entry | Source | Layer | Rule or test path | PR |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const { file, data } of entries) {
    const paths = asList(data.paths).map(codePath).join(' · ');
    const tests = asList(data.tests).map(codePath).join(', ');
    const where = [paths, tests && `tests ${tests}`].filter(Boolean).join(' · ');
    const title = data.title ?? file.replace(/\.md$/, '');
    rows.push(
      `| ${[
        data.date,
        `[${cell(title)}](docs/bug-rules/${file})`,
        data.source,
        data.layer,
        where,
        prLink(data.pr),
      ]
        .map(cell)
        .join(' | ')} |`,
    );
  }
  return rows.join('\n');
}

export function main(argv = process.argv.slice(2)) {
  const check = argv.includes('--check');
  const dirArg = argv.find((arg) => !arg.startsWith('--'));
  const dir = dirArg ? resolve(dirArg) : DEFAULT_DIR;
  const { entries, errors, warnings } = readEntries(dir);

  if (warnings.length > 0) {
    process.stderr.write(
      `Bug -> rule log: ${warnings.length} warning(s), not failures\n` +
        warnings.map((warning) => `  - ${warning}`).join('\n') +
        '\n',
    );
  }
  if (errors.length > 0) {
    process.stderr.write(
      `Bug -> rule log: ${errors.length} problem(s) in ${dir}\n` +
        errors.map((error) => `  - ${error}`).join('\n') +
        '\n',
    );
    return 1;
  }
  if (check) {
    process.stdout.write(`Bug -> rule log: ${entries.length} entries OK\n`);
  } else {
    process.stdout.write(`${renderTable(entries)}\n`);
  }
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = main();
}
