import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pickLang, t, STRING_KEYS } from '../src/i18n.js';
import { TRACK_IDS, WEATHERS } from '../src/sim/track.js';
import { DRIVE_MODES } from '../src/sim/assist.js';
import { CAMERA_MODES } from '../src/render/cameraRig.js';
import { QUALITIES, ORIENTATIONS } from '../src/settings.js';

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('language pick: ?lang= beats the saved choice, which beats the browser list', () => {
  assert.equal(pickLang('en', 'ko', ['ko-KR']), 'en');
  assert.equal(pickLang(null, 'ko', ['en-US']), 'ko');
  assert.equal(pickLang('xx', 'yy', ['ko-KR', 'en']), 'ko');
  assert.equal(pickLang(null, null, ['fr-FR', 'en-GB', 'ko']), 'en');
  assert.equal(pickLang(null, null, ['ja-JP']), 'en');
  assert.equal(pickLang(null, null, []), 'en');
});

test('Korean and English have the same keys and placeholders', () => {
  assert.deepEqual([...STRING_KEYS.en].sort(), [...STRING_KEYS.ko].sort());
});

test('placeholders are filled, unknown ones are left visible', () => {
  // Outside a browser the language defaults to English.
  assert.equal(t('info.orient', { o: 'Portrait' }), 'Orientation: Portrait');
  assert.equal(t('lobby.netStatus', { code: 'AB12C' }), 'ONLINE · AB12C · {n}');
  assert.throws(() => t('no.such.key'));
});

test('every key used by the markup and the code exists', () => {
  const used = new Set();
  const html = readFileSync('index.html', 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) used.add(m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const pair of m[1].split(';')) used.add(pair.split(':')[1]);
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
  for (const file of walk('src').filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bt\('([\w.]+)'/g)) used.add(m[1]);
    for (const m of src.matchAll(/'(key\.\w+)'/g)) used.add(m[1]);
  }
  // Keys built from ids: `track.${id}`, `hint.${id}` and so on.
  for (const id of TRACK_IDS) used.add(`track.${id}`).add(`hint.${id}`);
  for (const w of WEATHERS) used.add(`weather.${w}`).add(`hint.${w}`);
  for (const m of DRIVE_MODES) used.add(`drive.${m}`).add(`hint.${m}`);
  for (const c of CAMERA_MODES) used.add(`cam.${c}`);
  for (const q of QUALITIES) used.add(`quality.${q}`);
  for (const o of ORIENTATIONS) used.add(`orient.${o}`);
  const known = new Set(STRING_KEYS.ko);
  const missing = [...used].filter((k) => !known.has(k));
  assert.deepEqual(missing, []);
  assert.ok(used.size > 100);
});

test('translations keep the same placeholders', () => {
  // Read both tables through the module source: t() only serves one language at a time.
  const src = readFileSync('src/i18n.js', 'utf8');
  const tables = {};
  for (const lang of ['ko', 'en']) {
    const start = src.indexOf(`  ${lang}: {`);
    const body = src.slice(start, src.indexOf('\n  },', start));
    tables[lang] = Object.fromEntries([...body.matchAll(/'([\w.]+)': ("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)].map((m) => [m[1], m[2]]));
  }
  assert.equal(Object.keys(tables.ko).length, STRING_KEYS.ko.length);
  for (const key of STRING_KEYS.ko) assert.deepEqual(placeholders(tables.en[key]), placeholders(tables.ko[key]), key);
});
