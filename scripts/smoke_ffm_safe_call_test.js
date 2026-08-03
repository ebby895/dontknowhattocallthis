// Smoke test for ffmCallAttemptPublishClickSafe behavior
// Run with: node .\scripts\smoke_ffm_safe_call_test.js

// Minimal emulation of the safe-caller behavior from the content script
async function ffmCallAttemptPublishClickSafeEmu() {
  const rawArgs = Array.prototype.slice.call(arguments || []);
  let opts = null;
  if (rawArgs.length && rawArgs[rawArgs.length - 1] && typeof rawArgs[rawArgs.length - 1] === 'object' && !Array.isArray(rawArgs[rawArgs.length - 1])) {
    opts = rawArgs.pop();
  }
  const args = rawArgs;
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const defaultWait = 5000;
  const globalWaitRaw = (global && global.__ffm_safe_wait_ms);
  const globalWait = (typeof globalWaitRaw === 'number' || (typeof globalWaitRaw === 'string' && globalWaitRaw !== '')) ? Number(globalWaitRaw) : null;
  const optWaitRaw = (opts && opts.waitMs);
  const optWait = (typeof optWaitRaw === 'number' || (typeof optWaitRaw === 'string' && optWaitRaw !== '')) ? Number(optWaitRaw) : null;
  const maxWait = (typeof optWait === 'number' && isFinite(optWait) && optWait >= 0) ? optWait : (typeof globalWait === 'number' && isFinite(globalWait) && globalWait >= 0) ? globalWait : defaultWait;
  console.log('ffmCallAttemptPublishClickSafeEmu: maxWait=', maxWait, 'defaultWait=', defaultWait, 'globalWait=', globalWait, 'optWait=', optWait);
  const step = 50;
  let waited = 0;
  while (typeof global.ffmAttemptPublishClick !== 'function' && waited < maxWait) {
    await sleep(step);
    waited += step;
    // log progress every 300ms
    if (waited % 300 === 0) console.log('waiting for ffmAttemptPublishClick...', waited, 'ms');
  }
  if (typeof global.ffmAttemptPublishClick === 'function') {
    return await global.ffmAttemptPublishClick.apply(null, args);
  }
  throw new Error('ffmAttemptPublishClick not defined after wait');
}

(async () => {
  console.log('Smoke test start: will define ffmAttemptPublishClick after 800ms and expect safe caller to invoke it.');

  // Schedule definition after 800ms on globalThis (emulates window in browser)
  setTimeout(() => {
    globalThis.ffmAttemptPublishClick = async function(publishId, invName) {
      console.log('ffmAttemptPublishClick invoked with', publishId, invName);
      return true;
    };
  }, 800);

  try {
    const start = Date.now();
    const res = await ffmCallAttemptPublishClickSafeEmu('test-pub-id', 'Inventory X');
    const elapsed = Date.now() - start;
    console.log('Safe call returned:', res, 'elapsed(ms)=', elapsed);
    process.exit(0);
  } catch (e) {
    console.error('Safe call failed:', e && e.message);
    process.exit(2);
  }
})();
