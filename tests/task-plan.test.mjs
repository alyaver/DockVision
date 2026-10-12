import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeTaskPlan } from '../client/src/lib/serializeTaskPlan.mjs';
import parser from '../server/lib/test-script/readTestScript.js';

const app = { name: 'notepad', executable: 'notepad.exe' };

for (const legacy of [false, true]) {
  // Run the same checks for the current plan shape and the older plan shape.
  const envelope = task => legacy
    ? { schemaVersion: 'dockvision.plan.v1', targetApp: app, steps: [task] }
    : plan([task]);
  const prefix = legacy ? 'steps[0]' : 'tasks[0]';
  for (const target of ['editor', 'notepad.editor', { type: 'namedControl', name: 'editor' }]) {
    test(`normalizes demo percentages (legacy=${legacy}, ${JSON.stringify(target)})`, () => {
      // Parse a supported target that uses the older top-level percentage fields.
      const result = parse(envelope({ ...click, target, xPercent: 0, yPercent: 100 }));
      // The parser moves the percentages into the canonical target object.
      assert.deepEqual(result.tasks[0], { ...click,
        target: { type: 'namedControl', name: 'editor', xPercent: 0, yPercent: 100 } });
      // Parsing the normalized plan again should not change it.
      assert.deepEqual(parse(result), result);
    });
  }
  test(`rejects duplicate nested and top-level percentages (legacy=${legacy})`, () => {
    // A supplied top-level percentage competes with its normalized target form;
    // the parser reports the original conflicting field for this case.
    rejects(envelope({ ...click,
      target: { type: 'namedControl', name: 'editor', xPercent: 25 }, xPercent: 25, yPercent: 75 }), `${prefix}.xPercent`, 'click');
  });
  for (const field of ['xPercent', 'yPercent']) {
    test(`rejects conflicting ${field} (legacy=${legacy})`, () => {
      // Do not allow two different values for the same percentage.
      rejects(envelope({ ...click, target: { type: 'namedControl', name: 'editor', [field]: 20 }, [field]: 30 }), `${prefix}.${field}`, 'click');
    });
    for (const value of [-1, 101, '50', null, false]) {
      test(`rejects invalid task ${field}=${JSON.stringify(value)} (legacy=${legacy})`, () => {
        // Top-level demo coordinates are normalized under target before range validation.
        rejects(envelope({ ...click, [field]: value }), `${prefix}.target.${field}`, 'click');
      });
    }
    for (const target of [{ type: 'screenPoint', x: 1, y: 2 }, { type: 'windowPoint', x: 1, y: 2 }]) {
      test(`rejects task ${field} on ${target.type} (legacy=${legacy})`, () => {
        // Point targets use x/y coordinates and cannot use percentage fields.
        rejects(envelope({ ...click, target, [field]: 50 }), `${prefix}.target`, 'click');
      });
    }
    test(`rejects ${field} on TYPE (legacy=${legacy})`, () => {
      // TYPE tasks do not have a click target.
      rejects(envelope({ ...type, [field]: 50 }), `${prefix}.${field}`, 'type');
    });
  }
}

test('single demo percentage leaves the other axis unspecified for runner defaults', () => {
  assert.deepEqual(parse(plan([{ ...click, yPercent: 10 }])).tasks[0].target,
    { type: 'namedControl', name: 'editor', yPercent: 10 });
});
const text = '  Punctuation: !? + ^ % {ENTER} "quoted" \\ 世界 🧪\tTabbed\nNext\r\nEnd  ';
const type = { id: 'type', action: 'TYPE', text };
const click = { id: 'click', action: 'CLICK', target: 'editor', button: 'left', clickCount: 1 };
const plan = (tasks = [click, type]) => ({ schemaVersion: 'dockvision.user-task-plan.v1', app, tasks });
const parse = value => parser.readTestScript({ fileName: 'plan.json', content: JSON.stringify(value) });
function rejects(value, path, stepId = null) {
  assert.throws(() => parse(value), error => {
    assert.equal(error.code, 'INVALID_TASK_PLAN');
    assert.equal(error.fieldErrors[0].path, path);
    assert.equal(error.fieldErrors[0].stepId, stepId);
    assert.ok(error.fieldErrors[0].message);
    return true;
  });
}

test('builder exports canonical JSON that round-trips with order, IDs and literal text intact', () => {
  const drafts = [
    { id: 'click', task: 'CLICK', targetType: 'named', target: 'editor' },
    { id: 'type', task: 'TYPE', text },
    { id: 'point', task: 'CLICK', targetType: 'coordinates', details: { x: '350', y: '240' } },
  ];
  for (const ordered of [drafts, [...drafts].reverse()]) {
    const content = serializeTaskPlan(' Example ', ordered);
    const exported = JSON.parse(content);
    assert.equal(exported.schemaVersion, 'dockvision.user-task-plan.v1');
    assert.equal(exported.name, 'Example');
    assert.deepEqual(exported.app, app);
    assert.equal(Object.hasOwn(exported, 'steps'), false);
    assert.deepEqual(exported.tasks.map(t => t.id), ordered.map(t => t.id));
    assert.equal(exported.tasks.find(t => t.id === 'type').text, text);
    assert.deepEqual(exported.tasks.find(t => t.id === 'point').target, { type: 'screenPoint', x: 350, y: 240 });
    assert.deepEqual(parser.readTestScript({ fileName: 'plan.json', content }), exported);
  }
});

for (const appField of ['app', 'targetApp']) {
  test(`legacy steps and ${appField} normalize to canonical fields`, () => {
    const legacy = { schemaVersion: 'dockvision.plan.v1', [appField]: app, steps: [click, type] };
    assert.deepEqual(parse(legacy), plan());
  });
}

for (const target of ['editor', 'fileMenu', 'editMenu', 'formatMenu', 'viewMenu', 'helpMenu',
  { type: 'namedControl', name: 'editor', xPercent: 0, yPercent: 100 },
  { type: 'screenPoint', x: 350, y: 240 }, { type: 'windowPoint', x: 0, y: 100 }]) {
  test(`accepts CLICK target ${JSON.stringify(target)}`, () => {
    const result = parse(plan([{ id: 'click', action: 'CLICK', target }]));
    assert.deepEqual(result.tasks[0], { ...click, target });
  });
}

test('normalizes qualified named-control aliases', () => {
  assert.equal(parse(plan([{ ...click, target: 'notepad.editor' }])).tasks[0].target, 'editor');
  assert.deepEqual(parse(plan([{ ...click, target: { type: 'namedControl', name: 'notepad.fileMenu' } }])).tasks[0].target,
    { type: 'namedControl', name: 'fileMenu' });
});

test('whitespace-only TYPE survives serialization and parsing', () => {
  const content = serializeTaskPlan('', [{ id: 'space', task: 'TYPE', text: ' \t\n ' }]);
  assert.equal(parser.readTestScript({ fileName: 'plan.json', content }).tasks[0].text, ' \t\n ');
});

test('rejects malformed JSON with a configuration error', () => {
  assert.throws(() => parser.readTestScript({ fileName: 'plan.json', content: '{' }), error =>
    error.code === 'INVALID_TASK_PLAN' && error.fieldErrors[0].path === 'configContent');
});

const invalid = [
  ['empty tasks', plan([]), 'tasks'],
  ['duplicate IDs', plan([type, type]), 'tasks[1].id', 'type'],
  ['missing ID', plan([{ action: 'TYPE', text: 'a' }]), 'tasks[0].id'],
  ['empty TYPE', plan([{ ...type, text: '' }]), 'tasks[0].text', 'type'],
  ['nonstring TYPE', plan([{ ...type, text: 42 }]), 'tasks[0].text', 'type'],
  ['unsupported action', plan([{ ...type, action: 'WAIT' }]), 'tasks[0].action', 'type'],
  ['lowercase action', plan([{ ...type, action: 'type' }]), 'tasks[0].action', 'type'],
  ['TYPE target', plan([{ ...type, target: 'editor' }]), 'tasks[0].target', 'type'],
  ['CLICK text', plan([{ ...click, text: 'a' }]), 'tasks[0].text', 'click'],
  ['unknown named target', plan([{ ...click, target: 'missing' }]), 'tasks[0].target', 'click'],
  ['missing target', plan([{ id: 'click', action: 'CLICK' }]), 'tasks[0].target', 'click'],
  ['null target', plan([{ ...click, target: null }]), 'tasks[0].target', 'click'],
  ['unknown target type', plan([{ ...click, target: { type: 'unknown' } }]), 'tasks[0].target', 'click'],
  ['string coordinate', plan([{ ...click, target: { type: 'screenPoint', x: '1', y: 2 } }]), 'tasks[0].target.x', 'click'],
  ['missing coordinate', plan([{ ...click, target: { type: 'windowPoint', x: 1 } }]), 'tasks[0].target.y', 'click'],
  ['unknown control', plan([{ ...click, target: { type: 'namedControl', name: 'missing' } }]), 'tasks[0].target.name', 'click'],
  ['invalid percentage', plan([{ ...click, target: { type: 'namedControl', name: 'editor', xPercent: 101 } }]), 'tasks[0].target.xPercent', 'click'],
  ['incompatible target field', plan([{ ...click, target: { type: 'screenPoint', x: 1, y: 2, name: 'editor' } }]), 'tasks[0].target.name', 'click'],
  ['invalid button', plan([{ ...click, button: 'middle' }]), 'tasks[0].button', 'click'],
  ['invalid click count', plan([{ ...click, clickCount: 3 }]), 'tasks[0].clickCount', 'click'],
];
for (const [name, value, path, id] of invalid) test(`rejects ${name} with task/field details`, () => rejects(value, path, id));

for (const schemaVersion of ['dockvision.plan.v1', 'dockvision.user-task-plan.v1']) {
  for (const competing of [null, false, {}]) {
    test(`rejects competing application fields (${schemaVersion}, ${JSON.stringify(competing)})`, () => {
      rejects({ ...plan(), schemaVersion, app, targetApp: competing }, 'targetApp');
    });
    test(`rejects competing task fields (${schemaVersion}, ${JSON.stringify(competing)})`, () => {
      rejects({ ...plan(), schemaVersion, steps: competing }, 'steps');
    });
  }
}

test('legacy validation errors reference the supplied field and task', () => {
  rejects({ schemaVersion: 'dockvision.plan.v1', targetApp: { ...app, executable: 'other.exe' }, steps: [type] }, 'targetApp.executable');
  rejects({ schemaVersion: 'dockvision.plan.v1', targetApp: app, steps: [{ ...type, text: '' }] }, 'steps[0].text', 'type');
});
