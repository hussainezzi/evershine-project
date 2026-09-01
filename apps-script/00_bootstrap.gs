/**
 * School OS — bootstrap
 *
 * Global constants, configuration access and spreadsheet handles.
 * Loaded first (numeric filename prefix keeps Apps Script's alphabetical
 * load order predictable).
 */

var APP = {
  name: 'School OS',
  version: '0.1.0',
  year: '2026-27',
  tz: 'Asia/Karachi'
};

/** PropertiesService keys. Spreadsheet ids live here, not in code. */
var PROP = {
  CORE_ID: 'ss_core_id',
  ACAD_ID: 'ss_acad_id',
  FEES_ID: 'ss_fees_id',
  ROOT_FOLDER: 'root_folder_id',
  SECRET: 'session_secret',
  CACHE_VER: 'cache_version',
  SEED_STAGE: 'seed_stage'
};

/** Logical spreadsheet keys used everywhere else in the codebase. */
var SS_KEY = { CORE: 'CORE', ACAD: 'ACAD', FEES: 'FEES' };

var _ssCache = {};

function props_() {
  return PropertiesService.getScriptProperties();
}

/**
 * Returns the Spreadsheet for a logical key, opening it at most once
 * per execution.
 */
function ss_(key) {
  if (_ssCache[key]) return _ssCache[key];
  var idKey = key === SS_KEY.CORE ? PROP.CORE_ID
            : key === SS_KEY.ACAD ? PROP.ACAD_ID
            : PROP.FEES_ID;
  var id = props_().getProperty(idKey);
  if (!id) {
    throw new Error('School OS is not set up yet. Run setupAndSeedDemoSchool() once from the editor.');
  }
  _ssCache[key] = SpreadsheetApp.openById(id);
  return _ssCache[key];
}

function isSetUp_() {
  return !!props_().getProperty(PROP.CORE_ID);
}

/**
 * School profile and tunables. Stored as key/value rows in Core!Config so a
 * school can be re-branded without a code change.
 */
function config_() {
  var cached = cacheGet_('config');
  if (cached) return cached;
  var rows = Repo.readAll(SS_KEY.CORE, 'Config');
  var out = {};
  rows.forEach(function (r) { out[r.key] = r.value; });
  cachePut_('config', out, 900);
  return out;
}

function configValue_(key, fallback) {
  var v = config_()[key];
  return (v === undefined || v === '') ? fallback : v;
}
