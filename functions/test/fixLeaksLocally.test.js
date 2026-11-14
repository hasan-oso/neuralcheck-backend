'use strict';

const assert = require('assert');
const {fixLeaksLocally, DICTIONARY_AR} = require('../src/analysis/fixLeaksLocally');

(async () => {
  // 1. Empty leaks → empty fixes, calledModel=false
  let r = await fixLeaksLocally(null, [], 'ar', null);
  assert.deepStrictEqual(r, {fixes: {}, applied: 0, skipped: 0, calledModel: false});

  // 2. Single-token leak in Arabic context
  r = await fixLeaksLocally(null, [{
    path: 'issues[0].description',
    original: 'تم اكتشاف root في الجهاز',
    tokens: ['root'],
  }], 'ar', null);
  assert.strictEqual(r.calledModel, false);
  assert.strictEqual(r.fixes['issues[0].description'],
      'تم اكتشاف صلاحيات الجذر في الجهاز');

  // 3. Multi-token English leak
  r = await fixLeaksLocally(null, [{
    path: 'summary',
    original: 'Battery temperature is high',
    tokens: ['Battery', 'temperature', 'is', 'high'],
  }], 'ar', null);
  assert.ok(r.fixes['summary']);
  assert.ok(r.fixes['summary'].includes('البطارية'));
  assert.ok(r.fixes['summary'].includes('درجة الحرارة'));

  // 4. Token not in dictionary stays in place
  r = await fixLeaksLocally(null, [{
    path: 'summary',
    original: 'The Foobar XYZ123',
    tokens: ['The', 'Foobar', 'XYZ123'],
  }], 'ar', null);
  // No dictionary entry → no fixes object key for this path
  assert.strictEqual(r.fixes['summary'], undefined);

  // 5. Unsupported language returns error
  r = await fixLeaksLocally(null, [{path: 'x', original: 'y', tokens: ['z']}],
      'fr', null);
  assert.strictEqual(r.error, 'unsupported_language:fr');

  // 6. Turkish dictionary basic test
  r = await fixLeaksLocally(null, [{
    path: 'summary',
    original: 'CPU performance dropped',
    tokens: ['CPU', 'performance', 'dropped'],
  }], 'tr', null);
  assert.ok(r.fixes['summary']);
  assert.ok(r.fixes['summary'].includes('İşlemci'));
  assert.ok(r.fixes['summary'].includes('Performans'));

  // 7. Dictionary has critical mandatory-table entries
  const requiredAr = ['cpu', 'gpu', 'ram', 'fps', 'wifi', 'bluetooth',
    'gps', 'nfc', 'tee', 'throttling', 'headroom', 'silicon'];
  for (const k of requiredAr) {
    assert.ok(DICTIONARY_AR[k], `DICTIONARY_AR missing entry: ${k}`);
  }

  console.log('fixLeaksLocally: 7/7 tests passed');
})();
