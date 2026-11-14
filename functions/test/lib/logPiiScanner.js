'use strict';

// logPiiScanner.js — ماسح نداءات log لحارس الخصوصية (V8، الدفعة ١، 2026-10-08 +03).
//
// قرار المستخدم (بنصّه): «لا مستند مستخدم ولا بريد ولا هاتف ولا رمز FCM في أيّ
// سجلّ، والمعرّفات مُهشَّرة. ويُضاف اختبار يرفض ذلك في الكود.»
//
// ليس ملفّ اختبار (لا .test.js) فلا يدخل حلقة السويت؛ يستعمله:
//   - test/piiLogGuard.test.js        → يمسح functions/src الحقيقية (القاعدة 37).
//   - test/piiLogGuardSeeded.test.js  → يثبت أن الماسح يميّز (عيّنة مزروعة).
//   - test/lib/logCallOracle.js       → مرجع مستقلّ (acorn المضمَّن في Node) يقارن
//                                       النداءات والمعرّفات بموضعها (القاعدة 38).
//
// ─── ما يفعله ───────────────────────────────────────────────────────────
// يُحوِّل المصدر إلى رموز (تعليقات مُسقَطة، نصّ السلاسل لا يُفحص، تعابير
// `${…}` داخل القوالب تُفحص كشيفرة)، يجد كل `console.<m>(…)` وكل
// `[….]logger.<m>(…)` بوسائطه كاملة ولو امتدّ على أسطر، ويفحص رموز الوسائط.
//
// ─── ما يرفضه ──────────────────────────────────────────────────────────
//   json-stringify-user-object : JSON.stringify على كائن مستخدم.
//   document-dump              : .data() بلا وسائط داخل نداء log (نسخ مستند).
//   whole-user-object          : كائن مستخدم/مالك كاملاً (لا حقل منه).
//   secret-field               : email / phone / displayName / fullName / fcmToken
//                                (أو اسم ينتهي بها) خارج presenceForLog، و
//                                `<مستخدم>.name`.
//   id-field                   : uid / userId / ownerId / technicianId / customerId
//                                (و…Uid، و…UserId/OwnerId) خارج hashIdForLog.
//   promo-code                 : قيمة رمز العرض (codeData.code / promoCode) خارج
//                                hashIdForLog.
//   session-code               : رمز الجلسة (كود الانضمام NC-XXXXXX): الاسم المجرّد
//                                `code`، أو `.code` على session/sessionData/…،
//                                أو `request.data.code` — **ولو داخل hashIdForLog**:
//                                فضاؤه 36^6 ≈ 2.2 مليار قيمة، فالهاش المقتطع (12
//                                سداسياً) يُعكَس بالتعداد، فالتهشير ليس تنقيحاً له.
//                                (أُضيف 2026-10-16: createScanSession.js:106 كان
//                                `console.log("3 - Generated code:", code)` ومرّ.)
//   session-id                 : معرّف مستند الجلسة: `sessionId` (و…SessionId، و
//                                `.sessionId`)، و`.id` على ref/sessionRef/sessionDoc/…
//                                خارج hashIdForLog. اختبار الحضور وحده
//                                (`sessionId ? … : …`) لا يُحسب. (أُضيف 2026-10-16:
//                                createScanSession.js:129 كان
//                                `console.log("4 - Session saved:", ref.id)` ومرّ.)
//   scan-id                    : معرّف الفحص (scanId — مفتاح مستندات reports وreportRaw وscanClaims وevaluations…): الاسم `scanId` (و…ScanId)، و`claimRef.id` (مفتاح قفل
//                                scanClaims = scanId)، و`reportDoc.id` (مستند reports/{scanId} في verifyReport.js: S-SUB-2، 2026-10-17) خارج hashIdForLog. اختبار الحضور وحده (`scanId ? … : …`) لا يُحسب. بخلاف رمز الجلسة، يُقبل مُهشَّراً (معرّف مستند لا سرّ يُدخَل).
//                                (أُضيف 2026-10-16، قرار المستخدم: «scanId: (أ) يُهشَّر في كل سجلّات الخادم». كانت أربعة وعشرون سطراً في functions/src تطبعه خامّاً ومرّت بالحارس لأن قواعده
//                                كانت أسماء معرّفات المستخدمين والأسرار ورمز العرض ورمز الجلسة ومعرّف الجلسة — وسطر submitEvaluation وحده هُشِّر بيد وحارسه نصّيّ خاصّ به.)
//   payment-id / report-id /   : (2026-10-18، البند ٤-ج) paymentId (و`payment.id`)، reportId وreportRef، shortId (رمز التقرير العلني = مفتاح وصول verifyReport)، و`doc.id` (لقطة المستند في الحلقات)
//   short-id / doc-id            خارج hashIdForLog. اختبار الحضور وحده (`x ? … : …`) لا يُحسب. ما يبقى خامّاً بقرار: test/lib/rawLogIdExceptions.js (ملفّ + قاعدة + نصّ النداء + سبب).
//   derived-id                 : متغيّر مشتقّ من معرّف خامّ في الملفّ نفسه (`const inputId = String(scanId).trim()` ثم طباعة inputId) — انظر findTaintedNames؛ يُقاس findDeclarators بـacorn.
//   console-alias              : `console` بلا `.m(` مباشرة (نسخ/تمرير يُخفي النداء)،
//                                أو logger.x بلا نداء.
//
// ─── حدوده (مُعلنة، القاعدة 22) ───────────────────────────────────────
//   * يفحص **الأسماء** داخل النداء. لا يتتبّع التسمية البديلة:
//     `const u = request.auth.uid; console.log(u)` يمرّ.
//   * لا يرى مستنداً غير مستخدم يحمل معرّفاً (`console.log(payment)`).
//   * لا يرى ما يحمله نصّ خطأ (e.message) — القاعدة 36، موضوع آخر. (مثاله: رسالة
//     خطأ من Firestore قد تحمل مسار مستند فيه معرّف؛ createScanSession.js:155 يطبع
//     رسالة الخطأ غير المتوقَّع منقّاةً من مفاتيح API وحدها.)
//   * scan-id بالأسماء أيضاً: `scanId` و`…ScanId` و`claimRef.id` و`reportDoc.id` وحدها. لا يرى `doc.id` ولا `reportRef.id` ولا مساراً يحمل المعرّف (`serverSamples/${scanId}.json.gz`،
//     `reports/<id>` في نصّ خطأ من Firestore/GCS). ونصّ الخطأ نفسه (`e.message`) لا يراه الماسح أصلاً: يُنقّى بـsanitizeFailureText (utils/failureText.js، S-SUB-2) في المواضع الثلاثة
//     المعروفة، ويحرس ذلك test/failureText.test.js لا هذا الماسح.
//   * القاعدتان الجديدتان بالأسماء: `.id` يُرفض على ref وsession* وحدها (لا على
//     claimRef ولا doc ولا c — وclaimRef.id وحده تحكمه scan-id)، وكل متغيّر اسمه `code` في نداء log يُعدّ رمز جلسة
//     (من أراد طباعة رمز خطأ يسمّيه errorCode)؛ والوصول المحسوب `x["code"]` لا يُرى.
//   * عند أيّ شكل لا يفهمه (قوس غير مغلق، نصّ غير منتهٍ) يرمي — لا يتجاوز بصمت.

const {hashIdForLog, presenceForLog} = require('../../src/utils/logRedaction');
const RAW_ID_EXCEPTIONS = require('./rawLogIdExceptions');

// أسماء المُنقّيَين من مصدرهما (القاعدة 24) — لا نسخة حرفية هنا.
const HASH_HELPER = hashIdForLog.name;
const PRESENCE_HELPER = presenceForLog.name;

// ═══════════════════════════════════════════════════════════════════════
// ١ — المحلّل: مصدر JS → رموز مسطَّحة
// ═══════════════════════════════════════════════════════════════════════

const KEYWORDS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'function', 'if',
  'import', 'in', 'instanceof', 'new', 'return', 'super', 'switch', 'this', 'throw',
  'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'let', 'static', 'async',
  'await', 'of', 'null', 'true', 'false',
]);
// الكلمات التي بعدها `/` بداية regex لا قسمة.
const REGEX_AFTER_KEYWORD = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw',
  'case', 'do', 'else', 'yield', 'await',
]);
const PUNCTS = [
  '>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=',
  '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>',
];
const NUM_RE = /^(0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(\d[\d_]*\.?[\d_]*|\.\d[\d_]*)([eE][+-]?\d[\d_]*)?)n?/;

const isIdStart = (c) => /[A-Za-z_$]/.test(c) || c.charCodeAt(0) > 127;
const isIdPart = (c) => /[A-Za-z0-9_$]/.test(c) || c.charCodeAt(0) > 127;

/**
 * @param {string} src
 * @return {{tokens: Array<{t: string, v: string, i: number, e: number}>, lineOf: function(number): number}}
 * t: id | num | str | regex | punct | tpl_start | tpl_end. تعبير القالب `${` يُدفَع
 * punct بقيمة '${' ويُغلَق بـ'}' عادية — فتوازن الأقواس يعامله كأيّ قوس مفتوح.
 */
function tokenize(src) {
  const tokens = [];
  let pos = 0;

  const fail = (msg) => {
    throw new Error(`logPiiScanner.tokenize: ${msg} عند الموضع ${pos} (السطر ${lineOfOffset(src, pos)})`);
  };

  const regexAllowed = () => {
    const prev = tokens[tokens.length - 1];
    if (!prev) return true;
    if (prev.t === 'punct') return !(prev.v === ')' || prev.v === ']' || prev.v === '}' || prev.v === '++' || prev.v === '--');
    if (prev.t === 'id') return REGEX_AFTER_KEYWORD.has(prev.v);
    return false; // num, str, regex, tpl_end
  };

  const scan = (insideTemplateExpr) => {
    let braceDepth = 0;
    while (pos < src.length) {
      const c = src[pos];
      const c2 = src[pos + 1];

      if (/\s/.test(c)) {
        pos++;
        continue;
      }
      if (c === '/' && c2 === '/') {
        while (pos < src.length && src[pos] !== '\n') pos++;
        continue;
      }
      if (c === '/' && c2 === '*') {
        const end = src.indexOf('*/', pos + 2);
        if (end < 0) fail('تعليق كتلة غير منتهٍ');
        pos = end + 2;
        continue;
      }
      if (c === '"' || c === '\'') {
        const start = pos;
        pos++;
        while (pos < src.length && src[pos] !== c) {
          if (src[pos] === '\\') pos++;
          else if (src[pos] === '\n') fail('نصّ غير منتهٍ');
          pos++;
        }
        if (pos >= src.length) fail('نصّ غير منتهٍ');
        tokens.push({t: 'str', v: src.slice(start + 1, pos), i: start, e: pos + 1});
        pos++;
        continue;
      }
      if (c === '`') {
        tokens.push({t: 'tpl_start', v: '`', i: pos, e: pos + 1});
        pos++;
        for (;;) {
          if (pos >= src.length) fail('قالب غير منتهٍ');
          const ch = src[pos];
          if (ch === '\\') {
            pos += 2;
          } else if (ch === '`') {
            tokens.push({t: 'tpl_end', v: '`', i: pos, e: pos + 1});
            pos++;
            break;
          } else if (ch === '$' && src[pos + 1] === '{') {
            tokens.push({t: 'punct', v: '${', i: pos, e: pos + 2});
            pos += 2;
            scan(true);
          } else {
            pos++;
          }
        }
        continue;
      }
      if (c === '/') {
        if (regexAllowed()) {
          const start = pos;
          pos++;
          let inClass = false;
          for (;;) {
            if (pos >= src.length || src[pos] === '\n') fail('regex غير منتهٍ');
            const ch = src[pos];
            if (ch === '\\') pos++;
            else if (ch === '[') inClass = true;
            else if (ch === ']') inClass = false;
            else if (ch === '/' && !inClass) break;
            pos++;
          }
          pos++;
          while (pos < src.length && /[a-z]/.test(src[pos])) pos++;
          tokens.push({t: 'regex', v: src.slice(start, pos), i: start, e: pos});
          continue;
        }
        // قسمة (أو /=) تسقط إلى المعاملات أدناه.
      }
      if (isIdStart(c)) {
        const start = pos;
        pos++;
        while (pos < src.length && isIdPart(src[pos])) pos++;
        tokens.push({t: 'id', v: src.slice(start, pos), i: start, e: pos});
        continue;
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(c2 || ''))) {
        const m = NUM_RE.exec(src.slice(pos, pos + 64));
        if (!m) fail('رقم غير مفهوم');
        tokens.push({t: 'num', v: m[0], i: pos, e: pos + m[0].length});
        pos += m[0].length;
        continue;
      }
      // معاملات/فواصل
      if (c === '{') braceDepth++;
      if (c === '}') {
        if (insideTemplateExpr && braceDepth === 0) {
          tokens.push({t: 'punct', v: '}', i: pos, e: pos + 1});
          pos++;
          return;
        }
        braceDepth--;
      }
      let matched = null;
      for (const p of PUNCTS) {
        if (src.startsWith(p, pos)) {
          if (p === '?.' && /[0-9]/.test(src[pos + 2] || '')) continue; // a?.5:1 — شرطي لا ?.
          matched = p;
          break;
        }
      }
      if (!matched) matched = c;
      tokens.push({t: 'punct', v: matched, i: pos, e: pos + matched.length});
      pos += matched.length;
    }
    if (insideTemplateExpr) fail('تعبير قالب ${…} غير مغلق');
  };

  scan(false);
  return {tokens, lineOf: (off) => lineOfOffset(src, off)};
}

function lineOfOffset(src, offset) {
  let line = 1;
  for (let k = 0; k < offset && k < src.length; k++) if (src[k] === '\n') line++;
  return line;
}

const isDot = (tk) => !!tk && tk.t === 'punct' && (tk.v === '.' || tk.v === '?.');
const isPunct = (tk, v) => !!tk && tk.t === 'punct' && tk.v === v;
const OPENERS = new Set(['(', '[', '{', '${']);
const CLOSERS = new Set([')', ']', '}']);

/** @return {number} فهرس الرمز المغلق المقابل للمفتوح عند openIdx. */
function matchClose(tokens, openIdx) {
  let depth = 0;
  for (let k = openIdx; k < tokens.length; k++) {
    const tk = tokens[k];
    if (tk.t !== 'punct') continue;
    if (OPENERS.has(tk.v)) depth++;
    else if (CLOSERS.has(tk.v)) {
      depth--;
      if (depth === 0) return k;
    }
  }
  throw new Error(`logPiiScanner.matchClose: قوس غير مغلق عند الموضع ${tokens[openIdx].i}`);
}

// ═══════════════════════════════════════════════════════════════════════
// ٢ — إيجاد نداءات log
// ═══════════════════════════════════════════════════════════════════════

/**
 * `console` (أو `logger`) مُمرَّراً وحده معامِلاً إلى دالّة مُعرَّفة في الملفّ نفسه
 * `function f(a, b, cons)` → اسم المعامِل المقابل يصير بديلاً مُراقَباً: كل
 * `cons.<m>(…)` نداء log يُفحَص كأيّ نداء. وإن تعذّر الحلّ (دالّة غير معرَّفة
 * هنا، أو معامِل غير مجرّد، أو أكثر من تعريف) فالاستعمال مرفوض.
 * (وقع في المستودع: verifyReport.js:418 يمرّر console إلى buildV7Response،
 * وcons.warn في :360 نداء log لا يراه بحثٌ عن `console.` وحده.)
 * @param {Array<Object>} tokens
 * @param {number} k فهرس رمز console/logger
 * @return {{name: string, declOffset: number}|null}
 */
function resolveParamAlias(tokens, k) {
  const prev = tokens[k - 1];
  const next = tokens[k + 1];
  if (!((isPunct(prev, '(') || isPunct(prev, ',')) && (isPunct(next, ')') || isPunct(next, ',')))) return null;

  let depth = 0;
  let argIndex = 0;
  let openIdx = -1;
  for (let j = k - 1; j >= 0; j--) {
    const t = tokens[j];
    if (t.t !== 'punct') continue;
    if (CLOSERS.has(t.v)) depth++;
    else if (OPENERS.has(t.v)) {
      if (depth === 0) {
        openIdx = j;
        break;
      }
      depth--;
    } else if (t.v === ',' && depth === 0) argIndex++;
  }
  if (openIdx < 1 || tokens[openIdx].v !== '(') return null;
  const callee = tokens[openIdx - 1];
  if (callee.t !== 'id' || KEYWORDS.has(callee.v) || isDot(tokens[openIdx - 2])) return null;

  const decls = [];
  for (let j = 0; j + 2 < tokens.length; j++) {
    if (tokens[j].t === 'id' && tokens[j].v === 'function' && tokens[j + 1].t === 'id' &&
        tokens[j + 1].v === callee.v && isPunct(tokens[j + 2], '(')) decls.push(j + 2);
  }
  if (decls.length !== 1) return null;
  const paramClose = matchClose(tokens, decls[0]);
  const params = [[]];
  let d = 0;
  for (let j = decls[0] + 1; j < paramClose; j++) {
    const t = tokens[j];
    if (t.t === 'punct') {
      if (OPENERS.has(t.v)) d++;
      else if (CLOSERS.has(t.v)) d--;
      else if (t.v === ',' && d === 0) {
        params.push([]);
        continue;
      }
    }
    params[params.length - 1].push(t);
  }
  const p = params[argIndex];
  if (!p || p.length !== 1 || p[0].t !== 'id') return null;
  return {name: p[0].v, declOffset: p[0].i};
}

/**
 * @param {string} src
 * @param {string} file اسم للتقرير فقط
 * @return {{file: string, calls: Array<Object>, unrecognized: Array<Object>, tokens: Array<Object>, aliases: Array<Object>}}
 */
function findLogCalls(src, file) {
  const {tokens, lineOf} = tokenize(src);
  const calls = [];
  const unrecognized = [];
  const aliases = new Map(); // اسم المعامِل → {base, declOffset}

  const pushCall = (k, calleeName) => {
    const tk = tokens[k];
    const name = tokens[k + 2];
    const open = tokens[k + 3];
    const closeIdx = matchClose(tokens, k + 3);
    calls.push({
      file,
      line: lineOf(tk.i),
      callee: `${calleeName}.${name.v}`,
      startOffset: tk.i,
      openOffset: open.i,
      closeOffset: tokens[closeIdx].i,
      argTokens: tokens.slice(k + 4, closeIdx),
      argText: src.slice(open.e, tokens[closeIdx].i).replace(/\s+/g, ' ').trim(),
    });
  };
  const isCallShape = (k) => isDot(tokens[k + 1]) && tokens[k + 2] && tokens[k + 2].t === 'id' &&
      isPunct(tokens[k + 3], '(');
  const flag = (k, name) => unrecognized.push({
    file,
    line: lineOf(tokens[k].i),
    rule: 'console-alias',
    name,
    snippet: src.slice(tokens[k].i, Math.min(src.length, tokens[k].i + 60)).replace(/\s+/g, ' '),
  });

  // مرحلة ١: console / logger
  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k];
    if (tk.t !== 'id') continue;
    let base = null;
    if (tk.v === 'console' && !isDot(tokens[k - 1])) base = 'console';
    else if (tk.v === 'logger' && isDot(tokens[k + 1])) base = 'logger';
    else continue;

    if (isCallShape(k)) {
      pushCall(k, base);
      continue;
    }
    const alias = base === 'console' ? resolveParamAlias(tokens, k) : null;
    if (alias && !aliases.has(alias.name)) aliases.set(alias.name, {base, declOffset: alias.declOffset});
    else flag(k, base); // غير محلول، أو اسم معامِل مسجَّل من نداء آخر (التباس) → رفض
  }

  // مرحلة ٢: نداءات عبر اسم المعامِل المُراقَب
  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k];
    if (tk.t !== 'id' || !aliases.has(tk.v) || isDot(tokens[k - 1])) continue;
    if (tk.i === aliases.get(tk.v).declOffset) continue; // موضع التصريح بالمعامِل
    if (isCallShape(k)) pushCall(k, tk.v);
    else flag(k, tk.v);
  }

  calls.sort((a, b) => a.startOffset - b.startOffset);
  return {file, calls, unrecognized, tokens, aliases: [...aliases.entries()].map(([name, v]) => ({name, ...v}))};
}

// ═══════════════════════════════════════════════════════════════════════
// ٣ — الحكم على وسائط نداء
// ═══════════════════════════════════════════════════════════════════════

// كائنات المستخدم الكاملة (اسم متغيّر مجرّد). `profile` عمداً خارجها: في هذا
// المستودع ملفّ جهاز (deviceProfile) لا ملفّ مستخدم.
const USER_OBJECT_NAMES = new Set([
  'user', 'userdata', 'userdoc', 'usersnap', 'userrecord', 'userprofile', 'userinfo',
  'owner', 'ownerdata', 'ownerdoc', 'actor', 'customer', 'customerdata', 'technician',
  'techniciandata',
]);
const SECRET_EXACT = new Set([
  'email', 'emailaddress', 'phone', 'phonenumber', 'phone_number', 'displayname',
  'fullname', 'fcmtoken', 'fcmtokens', 'pushtoken', 'devicetoken', 'registrationtoken',
]);
const SECRET_SUFFIX_RE = /(email|phone|phonenumber|displayname|fullname|fcmtoken)$/;
const PROMO_RECEIVERS = new Set(['codedata', 'promo', 'promocode', 'promodata', 'promodoc']);
const CONTROL_KEYWORDS = new Set(['if', 'while', 'for', 'switch', 'catch', 'return', 'typeof', 'await', 'new', 'in', 'of', 'else', 'do', 'void', 'throw', 'case', 'delete', 'yield']);

function isIdName(name) {
  const lc = name.toLowerCase();
  if (/^(uid|userid|ownerid|technicianid|customerid|joinedby|byuid)$/.test(lc)) return true;
  if (/[a-z0-9]Uid$/.test(name) || /_uid$/i.test(name)) return true; // ownerUid, joinerUid
  if (/(User|Owner|Technician|Customer)(Id|ID)$/.test(name)) return true; // sessionOwnerId
  return false;
}
function isSecretName(name) {
  const lc = name.toLowerCase();
  return SECRET_EXACT.has(lc) || SECRET_SUFFIX_RE.test(lc);
}

// رمز الجلسة ومعرّفها (2026-10-16): قيمتان تُعرِّفان جلسة (الأولى بيد من يعرفها يدخلها، والثانية مفتاح مستندها).
// مستقبلات `.code` التي تعني جلسة (`err.code` و`error.code` و`response.code` رموز أخطاء/ردود ولا تُرفض):
const SESSION_CODE_RECEIVERS = new Set(['session', 'sessiondata', 'sessiondoc', 'sessionsnap', 'scansession']);
// مستقبلات `.id` التي تعني مرجع/مستند جلسة. `ref` هو الاسم الذي يعطيه createScanSession.js لمرجع الجلسة المُنشأة
// (`const ref = await db.collection("scanSessions").add(session)`)؛ والماسح لا يرى المجموعة، فيُرفض `ref.id` بالاسم.
const SESSION_REF_RECEIVERS = new Set(['ref', 'sessionref', 'sessiondoc', 'sessionsnap', 'sessionsnapshot', 'scansession', 'scansessionref', 'session']);
function isSessionIdName(name) {
  return name.toLowerCase() === 'sessionid' || /[a-z0-9]SessionId$/.test(name); // sessionId، excludeSessionId، joinedSessionId
}
const isIdTok = (tk) => !!tk && tk.t === 'id';

/**
 * هل الرمز عند idx رمز جلسة؟ الاسم المجرّد `code`، أو `.code` على مستقبل جلسة، أو `request.data.code` (مُدخل الانضمام).
 * يُحسب ولو داخل hashIdForLog (فضاء الرمز قابل للتعداد).
 * @param {Array<Object>} toks
 * @param {number} idx
 * @return {boolean}
 */
function isSessionCodeToken(toks, idx) {
  if (toks[idx].v !== 'code') return false;
  if (!isDot(toks[idx - 1])) return true;
  const recv = toks[idx - 2];
  if (!isIdTok(recv)) return false;
  if (SESSION_CODE_RECEIVERS.has(recv.v.toLowerCase())) return true;
  return recv.v === 'data' && isDot(toks[idx - 3]) && isIdTok(toks[idx - 4]) && toks[idx - 4].v === 'request';
}

/**
 * هل الرمز عند idx معرّف مستند جلسة؟ (يُقبل خارج الحكم فقط داخل hashIdForLog — يقرّره المستدعي.)
 * `sessionId ? … : …` اختبار حضور لا طباعة قيمة فلا يُعدّ.
 * @param {Array<Object>} toks
 * @param {number} idx
 * @return {boolean}
 */
function isSessionIdToken(toks, idx) {
  const tk = toks[idx];
  if (isSessionIdName(tk.v)) return !isPunct(toks[idx + 1], '?');
  if (tk.v === 'id' && isDot(toks[idx - 1])) {
    const recv = toks[idx - 2];
    return isIdTok(recv) && SESSION_REF_RECEIVERS.has(recv.v.toLowerCase());
  }
  return false;
}

// معرّف الفحص (scanId): مفتاح reports/{scanId} وreportRaw/{scanId} وscanClaims/{scanId}. `claimRef` هو الاسم الذي تعطيه analyzeDevice وscanReservation لمرجع قفل الفحص (`scanClaims/{scanId}`)،
// فـ`claimRef.id` هو scanId بعينه بلا اسمه؛ والماسح لا يرى المجموعة فيرفضه بالاسم (كما `ref.id` للجلسة).
// و`reportDoc` (S-SUB-2، 2026-10-17): مستند reports/{scanId} في verifyReport.js — `reportDoc.id` هو scanId بعينه (buildV7Response(reportDoc.id, …) تسمّيه scanId).
const SCAN_REF_RECEIVERS = new Set(['claimref', 'reportdoc']);
function isScanIdName(name) {
  return name === 'scanId' || /[a-z0-9]ScanId$/.test(name); // scanId، excludeScanId، reportScanId
}

/**
 * هل الرمز عند idx معرّف فحص؟ (يُقبل داخل hashIdForLog وحده — يقرّره المستدعي.) `scanId ? … : …` اختبار حضور لا طباعة قيمة فلا يُعدّ.
 * @param {Array<Object>} toks
 * @param {number} idx
 * @return {boolean}
 */
function isScanIdToken(toks, idx) {
  const tk = toks[idx];
  if (isScanIdName(tk.v)) return !isPunct(toks[idx + 1], '?');
  if (tk.v === 'id' && isDot(toks[idx - 1])) {
    const recv = toks[idx - 2];
    return isIdTok(recv) && SCAN_REF_RECEIVERS.has(recv.v.toLowerCase());
  }
  return false;
}

// ─── معرّفات أخرى تُقبل مُهشَّرة فقط (البند ٤-ج، 2026-10-18) ──────────────────────────────────────────────────
// قرار المستخدم: «القاعدة 43 وتنقية السجلّات» (منقول عن أمر المنسّق، غير متحقَّق من هذا المستودع). الأسماء: paymentId (ودفعة `payment.id`)، reportId وreportRef (مفتاح reports/{scanId} باسم آخر)،
// shortId (رمز التقرير العلني: مفتاح وصول لـverifyReport)، و`doc.id` (اسم لقطة المستند في الحلقات: معرّف مستخدم أو جلسة أو فحص بلا اسمه).
const PAYMENT_REF_RECEIVERS = new Set(['payment', 'paymentref', 'paymentdoc', 'paymentsnap']);
const DOC_ID_RECEIVERS = new Set(['doc']);
const isPaymentIdName = (name) => name === 'paymentId' || /[a-z0-9]PaymentId$/.test(name);
const isReportIdName = (name) => name === 'reportId' || /[a-z0-9]ReportId$/.test(name) || name === 'reportRef' || /[a-z0-9]ReportRef$/.test(name);
const isShortIdName = (name) => name === 'shortId' || /[a-z0-9]ShortId$/.test(name);

/**
 * @param {Array<Object>} toks
 * @param {number} idx
 * @return {?string} payment-id | report-id | short-id | doc-id، أو null. اختبار الحضور وحده (`paymentId ? … : …`) لا يُعدّ.
 */
function otherIdRule(toks, idx) {
  const tk = toks[idx];
  const presence = isPunct(toks[idx + 1], '?');
  if (isPaymentIdName(tk.v)) return presence ? null : 'payment-id';
  if (isReportIdName(tk.v)) return presence ? null : 'report-id';
  if (isShortIdName(tk.v)) return presence ? null : 'short-id';
  if (tk.v === 'id' && isDot(toks[idx - 1])) {
    const recv = toks[idx - 2];
    if (isIdTok(recv)) {
      const r = recv.v.toLowerCase();
      if (PAYMENT_REF_RECEIVERS.has(r)) return 'payment-id';
      if (DOC_ID_RECEIVERS.has(r)) return 'doc-id';
    }
  }
  return null;
}
const OTHER_RULE_KIND = {'payment-id': 'paymentId', 'report-id': 'reportId', 'short-id': 'shortId', 'doc-id': 'docId'};

// ─── متغيّر مشتقّ من معرّف (البند ٤-ج): `const inputId = String(scanId).trim()` ثم `console.log(inputId)` ───────────
// الماسح بالأسماء لا يرى `inputId`. فيُحصى كل `const|let|var NAME = <تعبير>` ويُعدّ NAME «مشتقّاً» إن كان التعبير اشتقاقاً نصّياً خالصاً من معرّف خامّ: لا await ولا new ولا دالّة سهم ولا كائن/مصفوفة حرفيّان، وكل نداء فيه من
// القائمة أدناه (String، trim، toUpperCase…)، ويحمل رمز معرّف (أو مشتقّاً سابقاً) خارج hashIdForLog. ثم يُرفض NAME خامّاً في أيّ نداء log من الملفّ نفسه (بالاسم، بلا نطاق).
// **حدّه المُعلَن:** بالاسم وعلى مستوى الملفّ (متغيّران بالاسم نفسه في دالّتين يُعدّان واحداً — يُكتب استثناء إن وقع)، ولا يتتبّع الإسناد بعد التصريح (`x = scanId`) ولا التفكيك (`const {a} = …`) ولا المعاملات.
const DERIVATION_CALLS = new Set([
  'String', 'trim', 'trimStart', 'trimEnd', 'toUpperCase', 'toLowerCase', 'slice', 'substring', 'substr', 'replace', 'replaceAll',
  'toString', 'encodeURIComponent', 'decodeURIComponent', 'padStart', 'padEnd', 'concat', 'normalize',
]);

/**
 * كل تصريح `const|let|var NAME = …` (وما بعد الأوّل بفاصلة أيضاً) — تفكيك الكائن/المصفوفة يُتخطّى اسمه فقط.
 * @param {Array<Object>} tokens
 * @return {Array<{name: string, nameOffset: number, rhsStart: number, rhsEnd: number}>} rhs = فهرس الرموز [start, end)
 */
function findDeclarators(tokens) {
  const out = [];
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.t !== 'id' || !(t.v === 'const' || t.v === 'let' || t.v === 'var') || isDot(tokens[k - 1])) continue;
    let j = k + 1;
    for (;;) {
      let name = null;
      let nameOffset = -1;
      if (tokens[j] && tokens[j].t === 'id' && !KEYWORDS.has(tokens[j].v)) {
        name = tokens[j].v;
        nameOffset = tokens[j].i;
        j++;
      } else if (isPunct(tokens[j], '{') || isPunct(tokens[j], '[')) {
        j = matchClose(tokens, j) + 1;
      } else break;
      if (!isPunct(tokens[j], '=')) break;
      const rhsStart = j + 1;
      let depth = 0;
      let e = rhsStart;
      for (; e < tokens.length; e++) {
        const tk = tokens[e];
        if (tk.t !== 'punct') continue;
        if (OPENERS.has(tk.v)) depth++;
        else if (CLOSERS.has(tk.v)) {
          if (depth === 0) break;
          depth--;
        } else if (depth === 0 && (tk.v === ';' || tk.v === ',')) break;
      }
      if (name) out.push({name, nameOffset, rhsStart, rhsEnd: e});
      if (!isPunct(tokens[e], ',')) break;
      j = e + 1;
    }
  }
  return out;
}

/**
 * يمشي رموز مقطع ويُبلغ زائره بكل رمز غير علامة ترقيم مع «هل هو داخل hashIdForLog». (أقواس ( [ { ${ تفتح إطاراً، وإطار ( باسم المستدعى قبله.)
 * @param {Array<Object>} toks
 * @param {function(number, boolean): void} visit
 */
function walkFrames(toks, visit) {
  const frames = [];
  for (let idx = 0; idx < toks.length; idx++) {
    const tk = toks[idx];
    if (tk.t === 'punct') {
      if (tk.v === '(') {
        const prev = toks[idx - 1];
        frames.push(prev && prev.t === 'id' && !CONTROL_KEYWORDS.has(prev.v) ? prev.v : null);
      } else if (OPENERS.has(tk.v)) frames.push(null);
      else if (CLOSERS.has(tk.v)) frames.pop();
      continue;
    }
    visit(idx, frames.includes(HASH_HELPER));
  }
}

/**
 * نوع المعرّف عند idx: uid | sessionId | scanId | paymentId | reportId | shortId | docId | derived — أو null. (رمز الجلسة `code` ليس هنا: يُرفض ولو مُهشَّراً، قاعدة session-code.)
 * @param {Array<Object>} toks
 * @param {number} idx
 * @param {Map<string, string>} tainted
 * @return {?string}
 */
function idKindAt(toks, idx, tainted) {
  const tk = toks[idx];
  const prev = toks[idx - 1];
  const next = toks[idx + 1];
  if (tk.t === 'str') return isPunct(prev, '[') && isPunct(next, ']') && isIdName(tk.v) ? 'uid' : null;
  if (tk.t !== 'id' || KEYWORDS.has(tk.v)) return null;
  if (isPunct(next, ':') && (isPunct(prev, '{') || isPunct(prev, ','))) return null; // مفتاح كائن
  if (isIdName(tk.v)) return 'uid';
  if (isSessionIdToken(toks, idx)) return 'sessionId';
  if (isScanIdToken(toks, idx)) return 'scanId';
  const other = otherIdRule(toks, idx);
  if (other) return OTHER_RULE_KIND[other];
  if (!isDot(prev) && tainted.has(tk.v) && !isPunct(next, '?')) return 'derived';
  return null;
}

/**
 * المتغيّرات المشتقّة من معرّف خامّ في ملفّ (انظر الشرح أعلاه). يتكرّر حتى لا يُضاف اسم (اشتقاق من مشتقّ).
 * @param {Array<Object>} tokens
 * @param {Array<Object>} declarators
 * @return {Map<string, string>} اسم المتغيّر ← نوع المعرّف الذي اشتُقّ منه
 */
function findTaintedNames(tokens, declarators) {
  const tainted = new Map();
  for (let pass = 0; pass < 8; pass++) {
    let grew = false;
    for (const d of declarators) {
      if (tainted.has(d.name)) continue;
      const toks = tokens.slice(d.rhsStart, d.rhsEnd);
      if (toks.length === 0) continue;
      let pure = true;
      for (let k = 0; k < toks.length; k++) {
        const tk = toks[k];
        if (tk.t === 'id' && (tk.v === 'await' || tk.v === 'new' || tk.v === 'function' || tk.v === 'async')) pure = false;
        if (tk.t === 'punct' && (tk.v === '=>' || tk.v === '{' || tk.v === '[')) pure = false; // كائن/مصفوفة/فهرسة: بنية لا اشتقاق نصّي
        // نداء: معرّف يليه «(» — حرّ أو طريقة — يجب أن يكون من القائمة المسموحة وإلا فليس اشتقاقاً نصّياً.
        if (tk.t === 'id' && isPunct(toks[k + 1], '(') && !KEYWORDS.has(tk.v) && !DERIVATION_CALLS.has(tk.v) && tk.v !== HASH_HELPER) pure = false;
      }
      if (!pure) continue;
      let found = null;
      walkFrames(toks, (idx, inHash) => {
        if (found || inHash) return;
        const kind = idKindAt(toks, idx, tainted);
        if (kind) found = kind === 'derived' ? tainted.get(toks[idx].v) : kind;
      });
      if (found) {
        tainted.set(d.name, found);
        grew = true;
      }
    }
    if (!grew) break;
  }
  return tainted;
}

const EMPTY_TAINT = new Map();

/**
 * @param {{file: string, line: number, callee: string, argText: string, argTokens: Array<Object>}} call
 * @param {Map<string, string>} [tainted] متغيّرات مشتقّة من معرّف خامّ في الملفّ (findTaintedNames)
 * @return {Array<{rule: string, name: string, line: number, callee: string, file: string, snippet: string}>}
 */
function analyzeCall(call, tainted = EMPTY_TAINT) {
  const toks = call.argTokens;
  const violations = [];
  const frames = []; // {helper: string|null}
  const inHelper = (h) => frames.some((f) => f.helper === h);
  const inJsonStringify = () => frames.some((f) => f.helper === 'JSON.stringify');
  const push = (rule, tk) => violations.push({
    rule, name: tk.v, file: call.file, line: call.line, callee: call.callee,
    snippet: call.argText.slice(0, 160), argText: call.argText,
  });

  for (let idx = 0; idx < toks.length; idx++) {
    const tk = toks[idx];
    const prev = toks[idx - 1];
    const next = toks[idx + 1];

    if (tk.t === 'punct') {
      if (tk.v === '(') {
        let helper = null;
        if (prev && prev.t === 'id' && !CONTROL_KEYWORDS.has(prev.v)) {
          helper = prev.v;
          if (prev.v === 'stringify' && isDot(toks[idx - 2]) && toks[idx - 3] && toks[idx - 3].v === 'JSON') {
            helper = 'JSON.stringify';
          }
        }
        frames.push({helper});
      } else if (OPENERS.has(tk.v)) {
        frames.push({helper: null});
      } else if (CLOSERS.has(tk.v)) {
        frames.pop();
      }
      continue;
    }

    // وصول محسوب: user["fcmToken"] — السلسلة اسم حقل لا نصّ عرض.
    if (tk.t === 'str') {
      if (isPunct(prev, '[') && isPunct(next, ']')) {
        if (isSecretName(tk.v) && !inHelper(PRESENCE_HELPER)) push('secret-field', tk);
        else if (isIdName(tk.v) && !inHelper(HASH_HELPER)) push('id-field', tk);
      }
      continue;
    }
    if (tk.t !== 'id' || KEYWORDS.has(tk.v)) continue;

    const lc = tk.v.toLowerCase();
    const propAccess = isDot(prev);
    // مفتاح كائن: { userId: … } — الاسم وسم لا قيمة. (القيمة تُفحَص برمزها.)
    const isObjectKey = isPunct(next, ':') && (isPunct(prev, '{') || isPunct(prev, ','));

    // .data() بلا وسائط = نسخ مستند كامل إلى السجلّ.
    if (tk.v === 'data' && propAccess && isPunct(next, '(') && isPunct(toks[idx + 2], ')')) {
      push('document-dump', tk);
      continue;
    }

    if (isObjectKey) continue;

    // JSON.stringify على أيّ اسم مستخدم.
    if (inJsonStringify() && USER_OBJECT_NAMES.has(lc)) {
      push('json-stringify-user-object', tk);
    }

    // كائن مستخدم كاملاً: اسم مجرّد لا يليه وصول لحقل.
    if (!propAccess && USER_OBJECT_NAMES.has(lc) &&
        !(isDot(next) || isPunct(next, '[') || isPunct(next, '('))) {
      if (!inHelper(PRESENCE_HELPER) && !inJsonStringify()) push('whole-user-object', tk);
      continue;
    }

    // <مستخدم>.name
    if (tk.v === 'name' && propAccess && toks[idx - 2] && toks[idx - 2].t === 'id' &&
        USER_OBJECT_NAMES.has(toks[idx - 2].v.toLowerCase())) {
      if (!inHelper(PRESENCE_HELPER)) push('secret-field', tk);
      continue;
    }

    if (isSecretName(tk.v)) {
      if (!inHelper(PRESENCE_HELPER)) push('secret-field', tk);
      continue;
    }
    if (isIdName(tk.v)) {
      if (!inHelper(HASH_HELPER)) push('id-field', tk);
      continue;
    }

    // رمز الجلسة: يُرفض ولو مُهشَّراً (قابل للتعداد). ثمّ معرّف مستند الجلسة: يُقبل مُهشَّراً فقط.
    if (isSessionCodeToken(toks, idx)) {
      push('session-code', tk);
      continue;
    }
    if (isSessionIdToken(toks, idx)) {
      if (!inHelper(HASH_HELPER)) push('session-id', tk);
      continue;
    }
    // معرّف الفحص: يُقبل مُهشَّراً فقط (S-SUB، 2026-10-16).
    if (isScanIdToken(toks, idx)) {
      if (!inHelper(HASH_HELPER)) push('scan-id', tk);
      continue;
    }

    // معرّفات الدفعة/التقرير/الرمز العلني ولقطة المستند (البند ٤-ج): تُقبل مُهشَّرة فقط.
    const otherRule = otherIdRule(toks, idx);
    if (otherRule) {
      if (!inHelper(HASH_HELPER)) push(otherRule, tk);
      continue;
    }
    // متغيّر مشتقّ من معرّف خامّ في الملفّ نفسه (`inputId = String(scanId).trim()`).
    if (!propAccess && tainted.has(tk.v) && !isPunct(next, '?')) {
      if (!inHelper(HASH_HELPER)) push('derived-id', tk);
      continue;
    }

    // رمز العرض: codeData.code / promo.code / promoCode
    if (lc === 'promocode' ||
        (tk.v === 'code' && propAccess && toks[idx - 2] && toks[idx - 2].t === 'id' &&
         PROMO_RECEIVERS.has(toks[idx - 2].v.toLowerCase()))) {
      if (!inHelper(HASH_HELPER)) push('promo-code', tk);
    }
  }
  return violations;
}

/**
 * @param {string} file
 * @param {string} src
 * @return {{file: string, calls: Array<Object>, violations: Array<Object>, unrecognized: Array<Object>, helperImportProblems: Array<string>}}
 */
const RULE_FOR_KIND = {uid: 'id-field', sessionId: 'session-id', scanId: 'scan-id', paymentId: 'payment-id', reportId: 'report-id', shortId: 'short-id', docId: 'doc-id', derived: 'derived-id'};

/**
 * @param {Object} v مخالفة (file, rule, argText)
 * @param {Array<{file: string, rule: string, snippet: string, reason: string}>} exceptions
 * @return {?Object} الاستثناء المطابق
 */
function matchException(v, exceptions) {
  return exceptions.find((x) => x.file === v.file && x.rule === v.rule && v.argText.includes(x.snippet)) || null;
}

/**
 * جرد كل ورود معرّف داخل نداءات log (البند ٤-ج): ملفّ:سطر · نوع المعرّف · الحالة. `hashed` داخل hashIdForLog، `raw` خارجه، و`raw-by-decision` خامّ مغطّى باستثناء مكتوب السبب.
 * يستعمل المسندات نفسها التي تحكم بها analyzeCall (فهما يتّفقان بالبناء) — وتقارنهما test/logIdInventory.test.js بعدد المخالفات.
 * @param {string} file
 * @param {string} src
 * @param {{exceptions?: Array<Object>}} [opts]
 * @return {Array<{file: string, line: number, callee: string, kind: string, name: string, state: string, reason: ?string}>}
 */
function inventorySource(file, src, {exceptions = RAW_ID_EXCEPTIONS} = {}) {
  const found = findLogCalls(src, file);
  const tainted = findTaintedNames(found.tokens, findDeclarators(found.tokens));
  const rows = [];
  for (const call of found.calls) {
    walkFrames(call.argTokens, (idx, inHash) => {
      const kind = idKindAt(call.argTokens, idx, tainted);
      if (!kind) return;
      let state = inHash ? 'hashed' : 'raw';
      let reason = null;
      if (state === 'raw') {
        const ex = matchException({file, rule: RULE_FOR_KIND[kind], argText: call.argText}, exceptions);
        if (ex) {
          state = 'raw-by-decision';
          reason = ex.reason;
        }
      }
      rows.push({file, line: call.line, callee: call.callee, kind, name: call.argTokens[idx].v, state, reason});
    });
  }
  return rows;
}

function scanSource(file, src, {exceptions = RAW_ID_EXCEPTIONS} = {}) {
  const found = findLogCalls(src, file);
  const declarators = findDeclarators(found.tokens);
  const tainted = findTaintedNames(found.tokens, declarators);
  const all = [];
  for (const call of found.calls) all.push(...analyzeCall(call, tainted));
  // استثناءات الخامّ المكتوبة السبب (test/lib/rawLogIdExceptions.js): تُنقل من المخالفات إلى excepted (يعدّها logIdInventory.test.js، ولا تختفي).
  const violations = [];
  const excepted = [];
  for (const v of all) {
    const ex = matchException(v, exceptions);
    if (ex) excepted.push({...v, reason: ex.reason});
    else violations.push(v);
  }
  violations.push(...found.unrecognized);

  // استعمال أحد المنقّيَين يعني استيراده من utils/logRedaction — لا تعريف محلّي
  // بالاسم نفسه (القاعدة 24).
  const helperImportProblems = [];
  const toks = found.tokens;
  // الأسماء المفكَّكة من require(".../utils/logRedaction"): `const {a, b} = require(...)`.
  const importedNames = new Set();
  toks.forEach((tk, k) => {
    if (tk.t !== 'str' || !/(^|\/)utils\/logRedaction$/.test(tk.v)) return;
    if (!isPunct(toks[k - 1], '(') || !toks[k - 2] || toks[k - 2].v !== 'require') return;
    let j = k - 3;
    if (!(isPunct(toks[j], '=') && isPunct(toks[j - 1], '}'))) return;
    for (j -= 2; j >= 0 && !isPunct(toks[j], '{'); j--) if (toks[j].t === 'id') importedNames.add(toks[j].v);
  });
  for (const helper of [HASH_HELPER, PRESENCE_HELPER]) {
    const used = toks.some((tk) => tk.t === 'id' && tk.v === helper);
    if (!used) continue;
    const defined = toks.some((tk, k) => tk.t === 'id' && tk.v === helper &&
        ((toks[k - 1] && toks[k - 1].v === 'function') ||
         (isPunct(toks[k + 1], '=') && toks[k - 1] && (toks[k - 1].v === 'const' || toks[k - 1].v === 'let' || toks[k - 1].v === 'var'))));
    if (defined) helperImportProblems.push(`${helper} معرَّف محلّياً — يجب أن يُستورَد من utils/logRedaction`);
    if (!importedNames.has(helper)) {
      helperImportProblems.push(`${helper} مستعمَل وليس ضمن تفكيك require("…/utils/logRedaction") — ReferenceError عند التشغيل`);
    }
  }
  return {file, calls: found.calls, violations, excepted, unrecognized: found.unrecognized, helperImportProblems, declarators, tainted};
}

module.exports = {
  tokenize,
  findLogCalls,
  analyzeCall,
  scanSource,
  inventorySource,
  findDeclarators,
  findTaintedNames,
  matchClose,
  HASH_HELPER,
  PRESENCE_HELPER,
  KEYWORDS,
  RULES: ['json-stringify-user-object', 'document-dump', 'whole-user-object', 'secret-field', 'id-field', 'promo-code', 'session-code', 'session-id', 'scan-id', 'payment-id', 'report-id', 'short-id', 'doc-id', 'derived-id', 'console-alias'],
};
