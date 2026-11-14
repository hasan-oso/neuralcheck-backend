'use strict';
// require-timer — preload (NODE_OPTIONS=--require) يقيس زمن كل Module._load
// (شامل/ذاتي بالمللي ثانية). بدل الاعتماد على إشارة إنهاء (SIGTERM لا
// يُسلَّم فعلياً بمعناها POSIX على ويندوز — Node يوثّق أن child.kill(sig)
// على ويندوز يُنهي العملية فوراً بصرف النظر عن الإشارة المذكورة، فمعالج
// JS لا يُشغَّل أصلاً؛ مُكتشَف تجريبياً هنا)، يفتح هذا الملفّ خادم HTTP
// خام منفصل تماماً عن express (منفذ من REQUIRE_TIMER_PORT) يُعيد بيانات
// التوقيت الحالية عند GET — تُستدعى بعد نجاح /__/functions.yaml مباشرة،
// قبل أي إنهاء للعملية (SIGKILL بعدها آمن، لا حاجة لخروج نظيف للحصول على
// البيانات).
const http = require('http');
const Module = require('module');

const timerPort = process.env.REQUIRE_TIMER_PORT ? Number(process.env.REQUIRE_TIMER_PORT) : null;
const originalLoad = Module._load;
const timings = [];
const stack = [];

Module._load = function(request, parent, isMain) {
  const startedAtEpochMs = Date.now(); // ساعة حائط — تُقارَن بطوابع العملية
  // الأمّ (spawnedAtMs/servingAtMs/readyAtMs في measure-load.js)، للفصل بين
  // ما يُحمَّل أثناء إقلاع express وما يُحمَّل أثناء loadStack الفعلي.
  const startNs = process.hrtime.bigint();
  stack.push(0n);
  try {
    return originalLoad.call(Module, request, parent, isMain);
  } finally {
    const endNs = process.hrtime.bigint();
    const totalNs = endNs - startNs;
    const childNs = stack.pop();
    const selfNs = totalNs - childNs;
    if (stack.length > 0) stack[stack.length - 1] += totalNs;
    timings.push({
      request,
      parent: (parent && parent.filename) || null,
      totalMs: Number(totalNs) / 1e6,
      selfMs: Number(selfNs) / 1e6,
      startedAtEpochMs,
    });
  }
};

if (timerPort) {
  const srv = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(timings));
  });
  srv.listen(timerPort, '127.0.0.1');
  srv.unref(); // لا يُبقي العملية حيّة لأجل هذا الخادم وحده
}
