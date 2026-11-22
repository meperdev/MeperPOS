// Pure semáforo classifier: changed files in, { color, reasons } out.
// No I/O and no dependencies, so it runs the same in CI, in tests and in the
// local demo. The rules live in config.json; see README.md for the model.

export const COLORS = Object.freeze(['verde', 'amarillo', 'rojo']);
const RANK = { verde: 0, amarillo: 1, rojo: 2 };

/** Highest of two colors; null means "no color yet". */
export function maxColor(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return RANK[b] > RANK[a] ? b : a;
}

const REGEX_SPECIALS = /[.+^$()|[\]\\]/g;

function globSource(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const segmentStart = i === 0 || glob[i - 1] === '/';
        const next = glob[i + 2];
        if (segmentStart && next === '/') {
          // `**/` = zero or more whole directories.
          out += '(?:.*/)?';
          i += 2;
        } else {
          // `dir/**` or a stray `**`: anything, slashes included.
          out += '.*';
          i += 1;
        }
        continue;
      }
      out += '[^/]*';
    } else if (c === '?') {
      out += '[^/]';
    } else if (c === '{') {
      const close = glob.indexOf('}', i);
      if (close === -1) {
        out += '\\{';
        continue;
      }
      // Non-nested alternatives; each one may itself use * ? and **.
      const alternatives = glob.slice(i + 1, close).split(',');
      out += `(?:${alternatives.map(globSource).join('|')})`;
      i = close;
    } else if (c === '}') {
      out += '\\}';
    } else {
      out += c.replace(REGEX_SPECIALS, '\\$&');
    }
  }
  return out;
}

/**
 * Glob to an anchored RegExp over repo-relative POSIX paths.
 * Supports `*` (within a segment), `?`, `**` (across segments, `**\/` may
 * match zero directories) and non-nested `{a,b}`. `*` matches dotfiles.
 */
export function globToRegExp(glob) {
  if (typeof glob !== 'string' || glob.length === 0) {
    throw new Error(`invalid glob: ${JSON.stringify(glob)}`);
  }
  return new RegExp(`^${globSource(glob)}$`);
}

function compileMatcher(paths, where) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error(`${where}: "paths" must be a non-empty array`);
  }
  const regexes = paths.map(globToRegExp);
  return (path) => regexes.some((re) => re.test(path));
}

function compileRule(rule, where) {
  if (!rule || typeof rule.id !== 'string' || !COLORS.includes(rule.color)) {
    throw new Error(`${where}: needs an "id" and a color in ${COLORS.join('/')}`);
  }
  if (typeof rule.reason !== 'string' || rule.reason.length === 0) {
    throw new Error(`${where} (${rule.id}): needs a "reason"`);
  }
  return { ...rule, matches: rule.paths ? compileMatcher(rule.paths, `${where} (${rule.id})`) : () => false };
}

/** Validates and compiles config.json. Throws on a malformed config. */
export function compileConfig(config) {
  if (!config || !Array.isArray(config.rules)) throw new Error('config: "rules" must be an array');
  const rules = config.rules.map((rule, i) => {
    const compiled = compileRule(rule, `rules[${i}]`);
    if (!rule.paths) throw new Error(`rules[${i}] (${rule.id}): needs "paths"`);
    return compiled;
  });
  const ids = new Set();
  for (const rule of rules) {
    if (ids.has(rule.id)) throw new Error(`config: duplicate rule id "${rule.id}"`);
    ids.add(rule.id);
  }
  const defaultRule = compileRule(config.defaultRule, 'defaultRule');
  const size = config.size ?? {};
  for (const key of ['maxVerdeChangedLines', 'maxVerdeFiles']) {
    if (!Number.isInteger(size[key]) || size[key] < 0) throw new Error(`config: size.${key} must be a non-negative integer`);
  }
  const excluded = size.excludeFromLineCount?.length ? compileMatcher(size.excludeFromLineCount, 'size.excludeFromLineCount') : () => false;
  const trust = (config.trustSuggestions?.rules ?? []).map((t, i) => {
    if (typeof t.label !== 'string') throw new Error(`trustSuggestions.rules[${i}]: needs a "label"`);
    return { ...t, matches: compileMatcher(t.paths, `trustSuggestions.rules[${i}]`) };
  });
  return { rules, defaultRule, size, excluded, trust };
}

function pathsOf(file) {
  const paths = [file.filename];
  if (typeof file.previous_filename === 'string' && file.previous_filename !== file.filename) {
    paths.push(file.previous_filename);
  }
  return paths;
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * @param {{ files?: Array<{filename: string, previous_filename?: string, status?: string, additions?: number, deletions?: number}>,
 *           totals?: { changedFiles?: number, additions?: number, deletions?: number } }} input
 *   `files` is the GitHub "list pull request files" payload; `totals` the PR's
 *   changed_files/additions/deletions, used to detect a truncated list.
 * @returns {{ color: 'verde'|'amarillo'|'rojo'|null,
 *             reasons: Array<{ id: string, color: string|null, reason: string, files: string[] }>,
 *             stats: { changedFiles: number, fetchedFiles: number, countedLines: number, truncated: boolean } }}
 */
export function classify(input, config) {
  const compiled = compileConfig(config);
  const files = (Array.isArray(input?.files) ? input.files : []).filter(
    (f) => f && typeof f.filename === 'string' && f.filename.length > 0,
  );
  const totals = input?.totals ?? {};
  const changedFiles = Math.max(toCount(totals.changedFiles), files.length);
  const truncated = changedFiles > files.length;

  let countedLines = 0;
  for (const file of files) {
    if (!compiled.excluded(file.filename)) countedLines += toCount(file.additions) + toCount(file.deletions);
  }
  if (truncated) {
    // Unseen files: fall back to the PR totals (lockfiles included).
    countedLines = Math.max(countedLines, toCount(totals.additions) + toCount(totals.deletions));
  }
  const stats = { changedFiles, fetchedFiles: files.length, countedLines, truncated };

  if (files.length === 0 && !truncated) {
    return { color: null, reasons: [{ id: 'empty', color: null, reason: 'No changed files', files: [] }], stats };
  }

  // rule id -> set of matching paths, for the rules that decided a file's color.
  const hits = new Map();
  let color = null;
  for (const file of files) {
    const matched = [];
    for (const path of pathsOf(file)) {
      for (const rule of compiled.rules) if (rule.matches(path)) matched.push({ rule, path });
    }
    if (matched.length === 0) matched.push({ rule: compiled.defaultRule, path: file.filename });
    const fileColor = matched.reduce((acc, m) => maxColor(acc, m.rule.color), null);
    for (const { rule, path } of matched) {
      if (rule.color !== fileColor) continue;
      if (!hits.has(rule.id)) hits.set(rule.id, new Set());
      hits.get(rule.id).add(path);
    }
    color = maxColor(color, fileColor);
  }

  const ordered = [...compiled.rules, compiled.defaultRule];
  let reasons = ordered
    .filter((rule) => rule.color === color && hits.has(rule.id))
    .map((rule) => ({ id: rule.id, color: rule.color, reason: rule.reason, files: [...hits.get(rule.id)].sort() }));

  const sizeReasons = [];
  if (truncated) {
    sizeReasons.push({
      id: 'truncated',
      color: 'amarillo',
      reason: `File list truncated: GitHub returned ${files.length} of ${changedFiles} files, unseen files were not classified`,
      files: [],
    });
  }
  const { maxVerdeChangedLines, maxVerdeFiles } = compiled.size;
  if (countedLines > maxVerdeChangedLines) {
    sizeReasons.push({ id: 'size-lines', color: 'amarillo', reason: `Large PR: ${countedLines} changed lines (verde allows up to ${maxVerdeChangedLines})`, files: [] });
  }
  if (changedFiles > maxVerdeFiles) {
    sizeReasons.push({ id: 'size-files', color: 'amarillo', reason: `Large PR: ${changedFiles} files (verde allows up to ${maxVerdeFiles})`, files: [] });
  }
  if (sizeReasons.length > 0) {
    if (color === 'verde' || color === null) {
      color = 'amarillo';
      reasons = sizeReasons;
    } else if (truncated) {
      reasons = [...reasons, sizeReasons[0]];
    }
  }

  return { color, reasons, stats };
}

/** Non-binding trust:* suggestion: the first trust rule with a matching path. */
export function suggestTrust(files, config) {
  const { trust } = compileConfig(config);
  const paths = (Array.isArray(files) ? files : [])
    .filter((f) => f && typeof f.filename === 'string')
    .flatMap(pathsOf);
  for (const rule of trust) {
    const path = paths.find((p) => rule.matches(p));
    if (path) return { label: rule.label, reason: rule.reason, example: path };
  }
  return null;
}
