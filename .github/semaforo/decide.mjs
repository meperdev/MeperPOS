// Pure label decision and comment rendering. No I/O.
//
// Ownership comes from the PR's issue events (who added or removed each
// semaforo:* label), not from state the bot stores itself: events cannot be
// edited by anyone, and they stay correct when a run is cancelled between two
// writes.

import { COLORS } from './classify.mjs';

/**
 * @param {Array<{event: string, label?: {name: string}, actor?: {login: string}, created_at?: string, id?: number}>} events
 * @returns {{ owners: Map<string, string>, humanTouched: boolean }}
 *   owners: label name -> login of whoever added it last.
 *   humanTouched: someone other than the bot added or removed a semaforo:* label.
 */
export function labelOwnership(events, { botLogin, labelPrefix }) {
  const owners = new Map();
  let humanTouched = false;
  const sorted = [...events]
    .filter((e) => (e.event === 'labeled' || e.event === 'unlabeled') && typeof e.label?.name === 'string')
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || (a.id ?? 0) - (b.id ?? 0));
  for (const e of sorted) {
    if (!e.label.name.startsWith(labelPrefix)) continue;
    const actor = e.actor?.login ?? '';
    if (actor !== botLogin) humanTouched = true;
    if (e.event === 'labeled') owners.set(e.label.name, actor);
    else owners.delete(e.label.name);
  }
  return { owners, humanTouched };
}

/**
 * Which semaforo labels to add and remove.
 *
 * - `semaforo:manual` present            -> mode "manual": no label changes.
 * - events unreadable (events === null)  -> mode "unknown": no label changes.
 * - a person ever added or removed a semaforo:* label, or a current color
 *   label has no bot "labeled" event     -> mode "human": no additions; the
 *   bot only removes its own color label when a person's color is also set,
 *   so the PR never shows two colors.
 * - no computed color (empty diff)       -> mode "empty": no label changes.
 * - otherwise                            -> mode "auto": the computed color
 *   replaces the bot's previous one.
 *
 * @returns {{ mode: 'manual'|'unknown'|'human'|'empty'|'auto', target: string|null, add: string[], remove: string[] }}
 */
export function decideLabels({ currentLabels, events, computedColor, config }) {
  const { labels, botLogin, labelPrefix } = config;
  const current = new Set(currentLabels ?? []);
  const colorLabels = COLORS.map((c) => labels[c]);
  const currentColors = colorLabels.filter((l) => current.has(l));
  const target = computedColor ? labels[computedColor] : null;
  const none = (mode) => ({ mode, target, add: [], remove: [] });

  if (current.has(labels.manual)) return none('manual');
  if (!Array.isArray(events)) return none('unknown');

  const { owners, humanTouched } = labelOwnership(events, { botLogin, labelPrefix });
  const botOwned = currentColors.filter((l) => owners.get(l) === botLogin);
  const humanOwned = currentColors.filter((l) => owners.get(l) !== botLogin);

  if (humanTouched || humanOwned.length > 0) {
    return { mode: 'human', target, add: [], remove: humanOwned.length > 0 ? botOwned : [] };
  }
  if (!target) return none('empty');
  return {
    mode: 'auto',
    target,
    add: current.has(target) ? [] : [target],
    remove: botOwned.filter((l) => l !== target),
  };
}

/** The bot's own summary comment: authored by the bot and carrying the marker. */
export function findBotComment(comments, { botLogin, commentMarker }) {
  return (comments ?? []).find((c) => c?.user?.login === botLogin && typeof c.body === 'string' && c.body.includes(commentMarker)) ?? null;
}

const MAX_FILES_SHOWN = 3;

function describeFiles(files) {
  if (files.length === 0) return '';
  const shown = files.slice(0, MAX_FILES_SHOWN).map((f) => `\`${f}\``).join(', ');
  const more = files.length > MAX_FILES_SHOWN ? ` and ${files.length - MAX_FILES_SHOWN} more` : '';
  return `: ${shown}${more}`;
}

function labelLine(decision, config, labelNote) {
  if (labelNote) return labelNote;
  switch (decision.mode) {
    case 'manual':
      return `\`${config.labels.manual}\` is set, so the bot leaves the semáforo labels alone.`;
    case 'human':
      return 'A person set or removed a semáforo label on this PR, so the bot leaves the labels alone. The color above is only a suggestion.';
    case 'unknown':
      return 'The label history could not be read, so no label was changed.';
    case 'empty':
      return 'No label: the PR has no changed files.';
    default:
      return `Label: \`${decision.target}\`.`;
  }
}

/**
 * Deterministic comment body (no timestamps or SHAs), so an unchanged PR
 * produces an identical body and the bot skips the write.
 */
export function buildComment({ classification, decision, trust, config, labelNote = null }) {
  const lines = [config.commentMarker];
  const color = classification.color ?? 'none';
  lines.push(`**Semáforo: ${color}**`, '');
  for (const r of classification.reasons) lines.push(`- ${r.reason}${describeFiles(r.files)}`);
  lines.push('');
  lines.push(labelLine(decision, config, labelNote));
  if (trust) {
    lines.push('', `Suggested trust label (not applied): \`${trust.label}\`, ${trust.reason} (\`${trust.example}\`).`);
  }
  lines.push(
    '',
    `<sub>Computed from the changed paths by \`.github/semaforo/config.json\`; highest color wins. This never blocks a merge. To override, set the label yourself or add \`${config.labels.manual}\`.</sub>`,
  );
  return `${lines.join('\n')}\n`;
}
