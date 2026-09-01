/**
 * School OS — repository layer
 *
 * THE ONLY FILE THAT MAY CALL SpreadsheetApp FOR DATA ACCESS.
 *
 * Services never touch a spreadsheet directly. If this system ever outgrows
 * Sheets, these functions are what get swapped for a real database and the
 * business logic above survives untouched.
 *
 * Everything is batched: one getValues() in, one setValues() out. A loop of
 * per-cell reads is the single most common reason an Apps Script app feels
 * broken.
 */

var Repo = (function () {

  function sheet_(ssKey, name) {
    var sh = ss_(ssKey).getSheetByName(name);
    if (!sh) throw new Error('Missing sheet: ' + name + ' in ' + ssKey);
    return sh;
  }

  function headers_(sh) {
    var last = sh.getLastColumn();
    if (last === 0) return [];
    return sh.getRange(1, 1, 1, last).getValues()[0];
  }

  /** Reads a whole sheet as an array of plain objects. */
  function readAll(ssKey, name) {
    var sh = sheet_(ssKey, name);
    var lastRow = sh.getLastRow();
    var lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol === 0) return [];

    var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
    var head = values[0];
    var out = [];
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      if (!String(row[0]).trim()) continue; // skip blank rows left by hand edits
      var obj = {};
      for (var c = 0; c < head.length; c++) {
        if (head[c]) obj[head[c]] = row[c];
      }
      obj._row = r + 1;
      out.push(obj);
    }
    return out;
  }

  /** Cached read for hot, rarely-changing tables. */
  function readCached(ssKey, name, seconds) {
    var key = 'tbl:' + ssKey + ':' + name;
    var hit = cacheGet_(key);
    if (hit) return hit;
    var rows = readAll(ssKey, name);
    cachePut_(key, rows, seconds || 600);
    return rows;
  }

  function find(ssKey, name, predicate) {
    var rows = readAll(ssKey, name);
    for (var i = 0; i < rows.length; i++) if (predicate(rows[i])) return rows[i];
    return null;
  }

  function filter(ssKey, name, predicate) {
    return readAll(ssKey, name).filter(predicate);
  }

  function indexBy(rows, key) {
    var out = {};
    rows.forEach(function (r) { out[r[key]] = r; });
    return out;
  }

  /** Appends objects; missing fields become empty cells. */
  function append(ssKey, name, objects) {
    if (!objects || !objects.length) return 0;
    var sh = sheet_(ssKey, name);
    var head = headers_(sh);
    var rows = objects.map(function (o) {
      return head.map(function (h) {
        var v = o[h];
        return (v === undefined || v === null) ? '' : v;
      });
    });
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, head.length).setValues(rows);
    bumpCache_();
    return rows.length;
  }

  /** Updates named fields on one row, located by its _row. */
  function updateRow(ssKey, name, rowNumber, patch) {
    var sh = sheet_(ssKey, name);
    var head = headers_(sh);
    var current = sh.getRange(rowNumber, 1, 1, head.length).getValues()[0];
    head.forEach(function (h, i) {
      if (patch.hasOwnProperty(h)) current[i] = patch[h];
    });
    sh.getRange(rowNumber, 1, 1, head.length).setValues([current]);
    bumpCache_();
  }

  /**
   * Bulk update by primary key. One read, one write — used by marks entry,
   * where 40 cells change at once and 40 separate writes would time out.
   */
  function updateMany(ssKey, name, keyField, patches) {
    if (!patches.length) return 0;
    var sh = sheet_(ssKey, name);
    var lastRow = sh.getLastRow();
    var head = headers_(sh);
    if (lastRow < 2) return 0;

    var range = sh.getRange(1, 1, lastRow, head.length);
    var values = range.getValues();
    var keyCol = head.indexOf(keyField);
    if (keyCol === -1) throw new Error('Unknown key field: ' + keyField);

    var byKey = {};
    patches.forEach(function (p) { byKey[p[keyField]] = p; });

    var touched = 0;
    for (var r = 1; r < values.length; r++) {
      var patch = byKey[values[r][keyCol]];
      if (!patch) continue;
      head.forEach(function (h, i) {
        if (patch.hasOwnProperty(h) && h !== keyField) values[r][i] = patch[h];
      });
      touched++;
    }
    if (touched) {
      range.setValues(values);
      bumpCache_();
    }
    return touched;
  }

  /** Replaces a sheet's entire body. Used by the seeder and the attendance grid. */
  function replaceAll(ssKey, name, headerRow, rows) {
    var ss = ss_(ssKey);
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
    } else {
      sh.clear();
    }
    sh.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headerRow.length).setFontWeight('bold').setBackground('#e8eee9');
    if (rows.length) {
      sh.getRange(2, 1, rows.length, headerRow.length).setValues(rows);
    }
    bumpCache_();
    return sh;
  }

  function audit(session, action, entity, entityId, before, after, note) {
    try {
      append(SS_KEY.CORE, 'AuditLog', [{
        ts: nowTs_(),
        user_id: session ? session.userId : 'system',
        role: session ? session.role : 'system',
        action: action,
        entity: entity,
        entity_id: entityId,
        before: before === undefined ? '' : JSON.stringify(before).slice(0, 400),
        after: after === undefined ? '' : JSON.stringify(after).slice(0, 400),
        note: note || ''
      }]);
    } catch (e) {
      // An audit failure must never take down the operation it describes.
      console.error('audit failed: ' + e);
    }
  }

  return {
    readAll: readAll,
    readCached: readCached,
    find: find,
    filter: filter,
    indexBy: indexBy,
    append: append,
    updateRow: updateRow,
    updateMany: updateMany,
    replaceAll: replaceAll,
    audit: audit,
    sheet: sheet_,
    headers: headers_
  };
})();
