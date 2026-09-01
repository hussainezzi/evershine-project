/**
 * School OS — utilities
 *
 * Ids, dates, hashing, cache and locking. Everything here is dependency-free
 * so it can be called from any layer.
 */

// ---------------------------------------------------------------- identifiers

function pad_(n, width) {
  var s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

function nextSeq_(counterName) {
  var p = props_();
  var key = 'seq_' + counterName;
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var n = Number(p.getProperty(key) || 0) + 1;
    p.setProperty(key, String(n));
    return n;
  } finally {
    lock.releaseLock();
  }
}

function studentId_(n) { return 'STU-' + APP.year.slice(0, 4) + '-' + pad_(n, 4); }
function staffId_(n)   { return 'STF-' + pad_(n, 4); }
function guardianId_(n){ return 'GRD-' + pad_(n, 4); }
function userId_(n)    { return 'USR-' + pad_(n, 4); }

function randomToken_(bytes) {
  var a = [];
  for (var i = 0; i < (bytes || 24); i++) a.push(Math.floor(Math.random() * 256));
  return Utilities.base64EncodeWebSafe(a).replace(/=+$/, '');
}

// --------------------------------------------------------------------- dates

function today_() {
  return Utilities.formatDate(new Date(), APP.tz, 'yyyy-MM-dd');
}

function fmtDate_(d) {
  return Utilities.formatDate(d, APP.tz, 'yyyy-MM-dd');
}

function monthKey_(d) {
  return Utilities.formatDate(d, APP.tz, 'yyyy-MM');
}

function parseDate_(s) {
  var p = String(s).split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

function isWeekend_(d) {
  var day = d.getDay();
  return day === 0; // Sunday only — Pakistani schools run Mon-Sat
}

function daysInMonth_(yyyymm) {
  var p = yyyymm.split('-');
  return new Date(Number(p[0]), Number(p[1]), 0).getDate();
}

function nowTs_() {
  return Utilities.formatDate(new Date(), APP.tz, 'yyyy-MM-dd HH:mm:ss');
}

// ------------------------------------------------------------------- hashing

/**
 * Iterated SHA-256. Apps Script has no bcrypt/PBKDF2, so this is the
 * available defence: a per-user salt plus enough rounds to make offline
 * guessing of a 4-6 digit PIN expensive without making login feel slow.
 */
function hashPin_(pin, salt) {
  var data = salt + '|' + pin;
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, data, Utilities.Charset.UTF_8);
  for (var i = 0; i < 800; i++) {
    bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.base64Encode(bytes) + salt);
  }
  return Utilities.base64Encode(bytes);
}

function newSalt_() { return randomToken_(12); }

function secret_() {
  var p = props_();
  var s = p.getProperty(PROP.SECRET);
  if (!s) {
    s = randomToken_(32);
    p.setProperty(PROP.SECRET, s);
  }
  return s;
}

function sign_(payload) {
  var sig = Utilities.computeHmacSha256Signature(payload, secret_());
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '');
}

// --------------------------------------------------------------------- cache

function cacheVersion_() {
  var v = props_().getProperty(PROP.CACHE_VER);
  if (!v) { v = '1'; props_().setProperty(PROP.CACHE_VER, v); }
  return v;
}

function bumpCache_() {
  var v = Number(cacheVersion_()) + 1;
  props_().setProperty(PROP.CACHE_VER, String(v));
  return v;
}

function cacheGet_(key) {
  try {
    var raw = CacheService.getScriptCache().get(cacheVersion_() + ':' + key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function cachePut_(key, value, seconds) {
  try {
    var raw = JSON.stringify(value);
    // CacheService rejects oversized values; skip rather than fail the request.
    if (raw.length > 90000) return;
    CacheService.getScriptCache().put(cacheVersion_() + ':' + key, raw, seconds || 600);
  } catch (e) { /* cache is an optimisation, never a dependency */ }
}

// ---------------------------------------------------------------------- lock

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    throw new Error('The system is busy saving another change. Please try again.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// -------------------------------------------------------------------- misc

function pick_(arr, rnd) {
  return arr[Math.floor((rnd === undefined ? Math.random() : rnd) * arr.length)];
}

function round2_(n) { return Math.round(n * 100) / 100; }

function sum_(arr) {
  return arr.reduce(function (a, b) { return a + (Number(b) || 0); }, 0);
}

function groupBy_(arr, keyFn) {
  var out = {};
  arr.forEach(function (item) {
    var k = keyFn(item);
    (out[k] = out[k] || []).push(item);
  });
  return out;
}
