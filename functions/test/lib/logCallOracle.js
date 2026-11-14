'use strict';

// logCallOracle.js — مرجع مستقلّ لماسح logPiiScanner (القاعدة 38: الأداة التي
// تقرأ مخرَج النظام تُقاس بمصدر مستقلّ قبل أن يُبنى على رقمها).
//
// يعمل **في عملية فرعية** بـ `node --expose-internals` لأن acorn المضمَّن في Node
// (internal/deps/acorn) محلّل JS حقيقي لا يشاركنا شيئاً من المحلّل اليدوي في
// logPiiScanner.js. لا اعتماديّة جديدة في package.json (functions/package.json
// يُنشَر). يُستدعى من test/piiLogGuard.test.js:
//
//   stdin  : JSON مصفوفة مسارات ملفّات مطلقة
//   stdout : JSON {[file]: {direct: [{callee, openOffset, closeOffset, ids}],
//                           consoleIds, loggerIds, declarators}}
//
//   direct : كل CallExpression callee فيه `console.<m>` أو `<…>.logger.<m>` أو
//            `logger.<m>`. ids = بدايات كل Identifier داخل الوسائط مرتّبة.
//   consoleIds / loggerIds : عدد كل Identifier بهذا الاسم في الملفّ.
//   declarators : كل VariableDeclarator اسمه Identifier وله قيمة ابتدائية: {name, nameOffset} مرتّبة (البند ٤-ج، 2026-10-18: مرجع findDeclarators في الماسح لقاعدة derived-id).
//
// الكلمات المحجوزة/السياقية تُسقَط من الجهتين بالقائمة نفسها (KEYWORDS في الماسح)
// لأن acorn قد يعطيها Identifier كاسم خاصّية (`obj.static`) والمحلّل اليدوي
// يعاملها كلمة.

const fs = require('fs');
const acorn = require('internal/deps/acorn/acorn/dist/acorn');
const {KEYWORDS} = require('./logPiiScanner');

// تجوال عامّ على كل عقد AST (مفاتيح الكائن، خاصّيات الوصول غير المحسوبة، …) —
// walk.full من acorn-walk لا يزور Property.key ولا MemberExpression.property غير
// المحسوبَين، وهما بالضبط ما يهمّنا (user.email، {userId: …}).
function eachNode(node, fn) {
  if (!node || typeof node.type !== 'string') return;
  fn(node);
  for (const key of Object.keys(node)) {
    const v = node[key];
    if (Array.isArray(v)) for (const x of v) eachNode(x, fn);
    else if (v && typeof v === 'object') eachNode(v, fn);
  }
}

const files = JSON.parse(fs.readFileSync(0, 'utf8'));
const result = {};

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const ast = acorn.parse(src, {
    ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, allowReturnOutsideFunction: true,
  });
  const direct = [];
  const declarators = [];
  let consoleIds = 0;
  let loggerIds = 0;

  eachNode(ast, (node) => {
    if (node.type === 'Identifier') {
      if (node.name === 'console') consoleIds++;
      if (node.name === 'logger') loggerIds++;
    }
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init) declarators.push({name: node.id.name, nameOffset: node.id.start});
    if (node.type !== 'CallExpression') return;
    const c = node.callee;
    if (c.type !== 'MemberExpression' || c.computed || c.property.type !== 'Identifier') return;
    const obj = c.object;
    const isConsole = obj.type === 'Identifier' && obj.name === 'console';
    const isLogger = (obj.type === 'Identifier' && obj.name === 'logger') ||
        (obj.type === 'MemberExpression' && !obj.computed && obj.property.type === 'Identifier' && obj.property.name === 'logger');
    if (!isConsole && !isLogger) return;

    const openOffset = src.indexOf('(', c.end);
    const closeOffset = node.end - 1;
    const ids = new Set();
    for (const arg of node.arguments) {
      eachNode(arg, (n) => {
        if (n.type === 'Identifier' && !KEYWORDS.has(n.name)) ids.add(n.start);
      });
    }
    direct.push({
      callee: `${isConsole ? 'console' : 'logger'}.${c.property.name}`,
      openOffset,
      closeOffset,
      ids: [...ids].sort((a, b) => a - b),
    });
  });

  direct.sort((a, b) => a.openOffset - b.openOffset);
  declarators.sort((a, b) => a.nameOffset - b.nameOffset);
  result[file] = {direct, consoleIds, loggerIds, declarators};
}

process.stdout.write(JSON.stringify(result));
