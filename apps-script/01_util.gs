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
//
// Two things matter here, and the first version got both wrong.
//
// 1. CacheService caps a single value at 100KB. The Students table serialises
//    to roughly 350KB, so the old "skip if too big" guard meant the largest and
//    hottest tables were NEVER cached — every read went to the sheet. Values are
//    now split across numbered chunk keys and reassembled.
//
// 2. Invalidation was a single global counter, so saving one attendance row
//    threw away the cached students, sections, config and permission matrix
//    too. Versions are now per table.

var CACHE_CHUNK = 90000;   // chars per cache entry, under the 100KB cap
var CACHE_MAX_CHUNKS = 24; // ~2MB ceiling for any one table

var _verMap = null;

/** Per-table version numbers, held in one property and memoised per execution. */
function versions_() {
  if (_verMap) return _verMap;
  try {
    _verMap = JSON.parse(props_().getProperty(PROP.CACHE_VER) || '{}');
  } catch (e) {
    _verMap = {};
  }
  return _verMap;
}

function versionOf_(table) {
  var v = versions_();
  return v[table] || 1;
}

/** Invalidates one table only. Everything else stays warm. */
function bumpTable_(table) {
  var v = versions_();
  v[table] = (v[table] || 1) + 1;
  props_().setProperty(PROP.CACHE_VER, JSON.stringify(v));
  return v[table];
}

/** Nuclear option — only for setup and seeding. */
function bumpCache_() {
  _verMap = {};
  props_().setProperty(PROP.CACHE_VER, '{}');
}

function cacheKey_(key) {
  return key + '@' + versionOf_(key);
}

function cacheGet_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var base = cacheKey_(key);
    var meta = cache.get(base + '#n');
    if (!meta) return null;

    var n = Number(meta);
    var names = [];
    for (var i = 0; i < n; i++) names.push(base + '#' + i);

    var parts = cache.getAll(names);   // one round trip for every chunk
    var raw = '';
    for (var j = 0; j < n; j++) {
      var piece = parts[base + '#' + j];
      if (piece === undefined || piece === null) return null;  // partial eviction
      raw += piece;
    }
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function cachePut_(key, value, seconds) {
  try {
    var raw = JSON.stringify(value);
    var n = Math.ceil(raw.length / CACHE_CHUNK);
    if (n > CACHE_MAX_CHUNKS) return;   // genuinely too big to be worth caching

    var base = cacheKey_(key);
    var map = { };
    map[base + '#n'] = String(n);
    for (var i = 0; i < n; i++) {
      map[base + '#' + i] = raw.substr(i * CACHE_CHUNK, CACHE_CHUNK);
    }
    CacheService.getScriptCache().putAll(map, seconds || 900);
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
