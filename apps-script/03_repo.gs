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

  /**
   * Per-execution memo.
   *
   * A single request used to read the same sheet several times over — a fee
   * page hit Invoices and Payments from four different functions, each one a
   * fresh full read. Within one execution the data cannot change under us
   * unless we write it, so the first read is kept and reused, and any write
   * drops the entry.
   */
  var _memo = {};

  function memoKey_(ssKey, name) { return ssKey + '!' + name; }

  function forget_(ssKey, name) {
    delete _memo[memoKey_(ssKey, name)];
    bumpTable_('tbl:' + ssKey + ':' + name);
  }

  function readSheet_(ssKey, name) {
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

  /** Reads a whole sheet as objects, memoised for this execution. */
  function readAll(ssKey, name) {
    var mk = memoKey_(ssKey, name);
    if (_memo[mk]) return _memo[mk];
    _memo[mk] = readSheet_(ssKey, name);
    return _memo[mk];
  }

  /** Memo, then CacheService, then the sheet. Use for read-heavy tables. */
  function readCached(ssKey, name, seconds) {
    var mk = memoKey_(ssKey, name);
    if (_memo[mk]) return _memo[mk];

    var key = 'tbl:' + ssKey + ':' + name;
    var hit = cacheGet_(key);
    if (hit) {
      _memo[mk] = hit;
      return hit;
    }
    var rows = readSheet_(ssKey, name);
    _memo[mk] = rows;
    cachePut_(key, rows, seconds || 900);
    return rows;
  }

  /** Bypasses both layers. Use inside a lock, where staleness is a correctness bug. */
  function readFresh(ssKey, name) {
    delete _memo[memoKey_(ssKey, name)];
    var rows = readSheet_(ssKey, name);
    _memo[memoKey_(ssKey, name)] = rows;
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
    forget_(ssKey, name);
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
    forget_(ssKey, name);
  }

  /**
   * Bulk update by primary key.
   *
   * Saving 30 marks used to read and rewrite the entire Marks sheet — about
   * 63,000 cells to change 30. Now it reads only the key column to locate the
   * rows, then reads and writes just the span those rows occupy. Rows written
   * by the same section sit together, so that span is usually the 30 rows.
   */
  function updateMany(ssKey, name, keyField, patches) {
    if (!patches.length) return 0;
    var sh = sheet_(ssKey, name);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return 0;

    var head = headers_(sh);
    var keyCol = head.indexOf(keyField);
    if (keyCol === -1) throw new Error('Unknown key field: ' + keyField);

    var byKey = {};
    patches.forEach(function (p) { byKey[String(p[keyField])] = p; });

    // One narrow read to find where the rows live.
    var keys = sh.getRange(2, keyCol + 1, lastRow - 1, 1).getValues();
    var targets = [];
    for (var i = 0; i < keys.length; i++) {
      if (byKey[String(keys[i][0])]) targets.push(i + 2);
    }
    if (!targets.length) return 0;

    var first = targets[0];
    var last = targets[targets.length - 1];
    var span = last - first + 1;

    // Scattered rows would make the span read pointless; fall back to whole sheet.
    if (span > targets.length * 4 && span > 200) {
      first = 2;
      span = lastRow - 1;
    }

    var range = sh.getRange(first, 1, span, head.length);
    var values = range.getValues();
    var touched = 0;

    for (var r = 0; r < values.length; r++) {
      var patch = byKey[String(values[r][keyCol])];
      if (!patch) continue;
      for (var c = 0; c < head.length; c++) {
        if (head[c] !== keyField && patch.hasOwnProperty(head[c])) {
          values[r][c] = patch[head[c]];
        }
      }
      touched++;
    }

    if (touched) {
      range.setValues(values);
      forget_(ssKey, name);
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
    forget_(ssKey, name);
    return sh;
  }

  /** Deletes every row below the header. Makes a re-run of a stage safe. */
  function clearBody(ssKey, name) {
    var sh = sheet_(ssKey, name);
    var last = sh.getLastRow();
    if (last > 1) sh.deleteRows(2, last - 1);
    forget_(ssKey, name);
    return last > 1 ? last - 1 : 0;
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
    readFresh: readFresh,
    forget: forget_,
    find: find,
    filter: filter,
    indexBy: indexBy,
    append: append,
    updateRow: updateRow,
    updateMany: updateMany,
    replaceAll: replaceAll,
    clearBody: clearBody,
    audit: audit,
    sheet: sheet_,
    headers: headers_
  };
})();
