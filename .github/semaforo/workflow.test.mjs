// The classifier reads its token from the environment (run.mjs: GITHUB_TOKEN
// required). GitHub generates secrets.GITHUB_TOKEN for every run but never
// exports it as an environment variable, so the step that runs the classifier
// has to pass it explicitly; without it every run ends as "skipped, nothing
// was changed" and no pull request is ever labelled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL('../workflows/semaforo.yml', import.meta.url),
  'utf8',
);

/** The text of one step, from its `- name:` line to the next step or EOF. */
function step(name) {
  const start = workflow.indexOf(`- name: ${name}`);
  assert.notEqual(start, -1, `step "${name}" not found in semaforo.yml`);
  const next = workflow.indexOf('\n      - name:', start + 1);
  return workflow.slice(start, next === -1 ? undefined : next);
}

test('the classifier step passes the run token to run.mjs', () => {
  const label = step('Label the pull request');
  assert.match(label, /node \.github\/semaforo\/run\.mjs/);
  assert.match(
    label,
    /\n\s+env:\n(?:\s+[A-Z_]+:.*\n)*?\s+GITHUB_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/,
  );
});

test('the workflow keeps the permission the token needs to label', () => {
  assert.match(workflow, /\n\s+pull-requests: write\n/);
});
