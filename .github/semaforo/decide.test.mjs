import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { buildComment, decideLabels, findBotComment, labelOwnership } from './decide.mjs';

const config = JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf8'));
const BOT = config.botLogin;

let seq = 0;
const ev = (event, label, actor) => ({ id: ++seq, event, label: { name: label }, actor: { login: actor }, created_at: `2026-11-22T00:00:${String(seq).padStart(2, '0')}Z` });
const decide = (currentLabels, events, computedColor) => decideLabels({ currentLabels, events, computedColor, config });

describe('labelOwnership', () => {
  it('tracks who added each semaforo label last and ignores other labels', () => {
    const { owners, humanTouched } = labelOwnership(
      [ev('labeled', 'semaforo:verde', BOT), ev('labeled', 'trust:01-codebase', 'meperdev')],
      { botLogin: BOT, labelPrefix: 'semaforo:' },
    );
    assert.equal(owners.get('semaforo:verde'), BOT);
    assert.equal(humanTouched, false);
  });

  it('flags a person removing a bot label', () => {
    const { owners, humanTouched } = labelOwnership(
      [ev('labeled', 'semaforo:verde', BOT), ev('unlabeled', 'semaforo:verde', 'meperdev')],
      { botLogin: BOT, labelPrefix: 'semaforo:' },
    );
    assert.equal(owners.has('semaforo:verde'), false);
    assert.equal(humanTouched, true);
  });

  it('orders events by time, not by array order', () => {
    const later = ev('labeled', 'semaforo:rojo', BOT);
    const earlier = { ...ev('unlabeled', 'semaforo:rojo', BOT), created_at: '2026-01-01T00:00:00Z' };
    const { owners } = labelOwnership([later, earlier], { botLogin: BOT, labelPrefix: 'semaforo:' });
    assert.equal(owners.get('semaforo:rojo'), BOT);
  });
});

describe('decideLabels', () => {
  it('first run on an unlabeled PR adds the computed color', () => {
    assert.deepEqual(decide([], [], 'amarillo'), { mode: 'auto', target: 'semaforo:amarillo', add: ['semaforo:amarillo'], remove: [] });
  });

  it('re-run with the same color writes nothing', () => {
    const d = decide(['semaforo:amarillo'], [ev('labeled', 'semaforo:amarillo', BOT)], 'amarillo');
    assert.deepEqual([d.add, d.remove], [[], []]);
  });

  it('a new color replaces the bot\'s previous one', () => {
    const d = decide(['semaforo:verde', 'trust:01-codebase'], [ev('labeled', 'semaforo:verde', BOT)], 'rojo');
    assert.deepEqual([d.mode, d.add, d.remove], ['auto', ['semaforo:rojo'], ['semaforo:verde']]);
  });

  it('cleans up two bot labels left by a cancelled run', () => {
    const d = decide(['semaforo:verde', 'semaforo:rojo'], [ev('labeled', 'semaforo:verde', BOT), ev('labeled', 'semaforo:rojo', BOT)], 'rojo');
    assert.deepEqual([d.add, d.remove], [[], ['semaforo:verde']]);
  });

  it('semaforo:manual freezes the labels', () => {
    const d = decide(['semaforo:manual', 'semaforo:verde'], [ev('labeled', 'semaforo:verde', BOT)], 'rojo');
    assert.deepEqual([d.mode, d.add, d.remove], ['manual', [], []]);
  });

  it('a label a person set (Kiroi with --label) is never overwritten', () => {
    const d = decide(['semaforo:rojo'], [ev('labeled', 'semaforo:rojo', 'meperdev')], 'amarillo');
    assert.deepEqual([d.mode, d.add, d.remove], ['human', [], []]);
  });

  it('when a person sets a color after the bot, the bot removes only its own label', () => {
    const d = decide(
      ['semaforo:amarillo', 'semaforo:rojo'],
      [ev('labeled', 'semaforo:amarillo', BOT), ev('labeled', 'semaforo:rojo', 'meperdev')],
      'amarillo',
    );
    assert.deepEqual([d.mode, d.add, d.remove], ['human', [], ['semaforo:amarillo']]);
  });

  it('a person removing the bot label is respected: nothing is re-added', () => {
    const d = decide([], [ev('labeled', 'semaforo:verde', BOT), ev('unlabeled', 'semaforo:verde', 'meperdev')], 'verde');
    assert.deepEqual([d.mode, d.add, d.remove], ['human', [], []]);
  });

  it('a color label with no known author is treated as a person\'s', () => {
    const d = decide(['semaforo:verde'], [], 'rojo');
    assert.deepEqual([d.mode, d.add, d.remove], ['human', [], []]);
  });

  it('unreadable history changes nothing', () => {
    assert.deepEqual(decide([], null, 'rojo'), { mode: 'unknown', target: 'semaforo:rojo', add: [], remove: [] });
  });

  it('no computed color (empty diff) changes nothing', () => {
    const d = decide(['semaforo:verde'], [ev('labeled', 'semaforo:verde', BOT)], null);
    assert.deepEqual([d.mode, d.add, d.remove], ['empty', [], []]);
  });

  it('non-semaforo labels never matter', () => {
    const d = decide(['trust:02-lint-test'], [ev('labeled', 'trust:02-lint-test', 'meperdev')], 'verde');
    assert.deepEqual([d.mode, d.add], ['auto', ['semaforo:verde']]);
  });
});

describe('comment', () => {
  const classification = { color: 'rojo', reasons: [{ id: 'auth', color: 'rojo', reason: 'Auth', files: ['a', 'b', 'c', 'd'] }], stats: {} };
  const decision = { mode: 'auto', target: 'semaforo:rojo', add: [], remove: [] };

  it('is deterministic and carries the marker', () => {
    const a = buildComment({ classification, decision, trust: null, config });
    const b = buildComment({ classification, decision, trust: null, config });
    assert.equal(a, b);
    assert.ok(a.startsWith(config.commentMarker));
    assert.match(a, /Semáforo: rojo/);
    assert.match(a, /`a`, `b`, `c` and 1 more/);
  });

  it('says the trust label is only a suggestion', () => {
    const body = buildComment({ classification, decision, trust: { label: 'trust:01-codebase', reason: 'r', example: 'x.dto.ts' }, config });
    assert.match(body, /Suggested trust label \(not applied\): `trust:01-codebase`/);
  });

  it('only a bot-authored comment with the marker is the bot comment', () => {
    const comments = [
      { id: 1, user: { login: 'meperdev' }, body: `quoting ${config.commentMarker}` },
      { id: 2, user: { login: BOT }, body: 'other bot comment' },
      { id: 3, user: { login: BOT }, body: `${config.commentMarker}\nx` },
    ];
    assert.equal(findBotComment(comments, config).id, 3);
    assert.equal(findBotComment([], config), null);
  });
});
