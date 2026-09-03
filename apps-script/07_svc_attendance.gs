/**
 * School OS — attendance
 *
 * Stored wide: one row per student per month, one column per day. That is
 * ~600 rows a month instead of ~13,000, roughly 30x cheaper to read and write,
 * and it prints as a register that looks like the paper one the school
 * already keeps.
 *
 * Codes: P present · A absent · L leave · E excused · H holiday · '' not marked
 */

var Attendance = (function () {

  function ensureMonth_(yyyymm) {
    var ss = ss_(SS_KEY.ACAD);
    var name = attendanceSheetName_(yyyymm);
    var sh = ss.getSheetByName(name);
    if (sh) return sh;

    var headers = attendanceHeaders_(yyyymm);
    var rows = [];
    School.sections().forEach(function (sec) {
      School.roster({ role: ROLE.PRINCIPAL, scope: { type: 'school', ids: [] } }, sec.key)
        .forEach(function (st) {
          var row = [st.studentId, sec.classId, sec.section, st.rollNo];
          for (var d = 0; d < daysInMonth_(yyyymm); d++) row.push('');
          row.push(0, 0, 0, 0);
          rows.push(row);
        });
    });
    return Repo.replaceAll(SS_KEY.ACAD, name, headers, rows);
  }

  function months() {
    return ss_(SS_KEY.ACAD).getSheets()
      .map(function (s) { return s.getName(); })
      .filter(function (n) { return n.indexOf('Attendance_') === 0; })
      .map(function (n) { return n.replace('Attendance_', ''); })
      .sort();
  }

  function latestMonth() {
    var m = months();
    return m.length ? m[m.length - 1] : null;
  }

  function readMonth_(yyyymm) {
    var sh = ss_(SS_KEY.ACAD).getSheetByName(attendanceSheetName_(yyyymm));
    if (!sh) return { headers: [], rows: [], sheet: null };
    var last = sh.getLastRow();
    if (last < 2) return { headers: Repo.headers(sh), rows: [], sheet: sh };
    var values = sh.getRange(1, 1, last, sh.getLastColumn()).getValues();
    return { headers: values[0], rows: values.slice(1), sheet: sh };
  }

  /** One section's marks for one day, ready for the teacher screen. */
  function forSectionDay(session, sectionKey, dateStr) {
    var d = parseDate_(dateStr);
    var yyyymm = monthKey_(d);
    ensureMonth_(yyyymm);

    var data = readMonth_(yyyymm);
    var dayCol = data.headers.indexOf('d' + pad_(d.getDate(), 2));
    var parts = sectionKey.split('-');
    var roster = School.roster(session, sectionKey);
    var byId = {};
    data.rows.forEach(function (r) {
      if (String(r[1]) === parts[0] && String(r[2]) === parts[1]) {
        byId[String(r[0])] = dayCol === -1 ? '' : String(r[dayCol] || '');
      }
    });

    return {
      date: dateStr,
      sectionKey: sectionKey,
      students: roster.map(function (s) {
        return {
          studentId: s.studentId,
          rollNo: s.rollNo,
          name: s.name,
          code: byId[s.studentId] || ''
        };
      })
    };
  }

  /**
   * Saves a whole section for one day in a single write.
   * marks: { studentId: 'P'|'A'|'L'|'E' }
   */
  function saveSectionDay(session, sectionKey, dateStr, marks) {
    var d = parseDate_(dateStr);
    var yyyymm = monthKey_(d);
    ensureMonth_(yyyymm);

    return withLock_(function () {
      var data = readMonth_(yyyymm);
      var dayCol = data.headers.indexOf('d' + pad_(d.getDate(), 2));
      if (dayCol === -1) throw new Error('That date is not in the attendance register.');

      var parts = sectionKey.split('-');
      var pCol = data.headers.indexOf('present');
      var aCol = data.headers.indexOf('absent');
      var lCol = data.headers.indexOf('leave');
      var pcCol = data.headers.indexOf('percent');
      var dayCols = data.headers.reduce(function (acc, h, i) {
        if (/^d\d\d$/.test(h)) acc.push(i);
        return acc;
      }, []);

      var changed = 0;
      data.rows.forEach(function (r) {
        if (String(r[1]) !== parts[0] || String(r[2]) !== parts[1]) return;
        var code = marks[String(r[0])];
        if (!code) return;
        r[dayCol] = code;
        changed++;

        var p = 0, a = 0, l = 0;
        dayCols.forEach(function (ci) {
          var v = String(r[ci] || '');
          if (v === 'P') p++;
          else if (v === 'A') a++;
          else if (v === 'L' || v === 'E') l++;
        });
        r[pCol] = p; r[aCol] = a; r[lCol] = l;
        r[pcCol] = (p + a + l) ? round2_(p * 100 / (p + a + l)) : 0;
      });

      if (changed) {
        data.sheet.getRange(2, 1, data.rows.length, data.headers.length)
                  .setValues(data.rows);
        bumpCache_();
      }
      Repo.audit(session, 'attendance.save', 'section', sectionKey, null,
                 { date: dateStr, count: changed });
      return { saved: changed, date: dateStr };
    });
  }

  /** Monthly percentage for one student — used on the report card and portal. */
  function studentMonth(studentId, yyyymm) {
    var data = readMonth_(yyyymm);
    if (!data.sheet) return null;
    var idx = data.headers;
    for (var i = 0; i < data.rows.length; i++) {
      if (String(data.rows[i][0]) !== String(studentId)) continue;
      var r = data.rows[i];
      var days = [];
      idx.forEach(function (h, c) {
        if (/^d\d\d$/.test(h)) days.push({ day: Number(h.slice(1)), code: String(r[c] || '') });
      });
      return {
        month: yyyymm,
        present: Number(r[idx.indexOf('present')] || 0),
        absent: Number(r[idx.indexOf('absent')] || 0),
        leave: Number(r[idx.indexOf('leave')] || 0),
        percent: Number(r[idx.indexOf('percent')] || 0),
        days: days
      };
    }
    return null;
  }

  function studentYear(studentId) {
    return months().map(function (m) {
      return studentMonth(studentId, m);
    }).filter(Boolean);
  }

  /**
   * Reads only the percent column rather than the whole month grid — 600 cells
   * instead of ~21,000. The dashboard calls this on every load.
   */
  function monthSummary(yyyymm) {
    var sh = ss_(SS_KEY.ACAD).getSheetByName(attendanceSheetName_(yyyymm));
    if (!sh) return { month: yyyymm, percent: 0, students: 0 };

    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { month: yyyymm, percent: 0, students: 0 };

    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var pcCol = headers.indexOf('percent');
    if (pcCol === -1) return { month: yyyymm, percent: 0, students: 0 };

    var vals = sh.getRange(2, pcCol + 1, lastRow - 1, 1).getValues()
      .map(function (r) { return Number(r[0] || 0); })
      .filter(function (v) { return v > 0; });

    return {
      month: yyyymm,
      students: lastRow - 1,
      percent: vals.length ? round2_(sum_(vals) / vals.length) : 0
    };
  }

  /** Students absent 3+ days running — the list a coordinator actually wants. */
  function chronicAbsentees(yyyymm, threshold) {
    var data = readMonth_(yyyymm);
    if (!data.sheet) return [];
    var students = Repo.indexBy(Repo.readCached(SS_KEY.CORE, 'Students'), 'student_id');
    var dayCols = data.headers.reduce(function (acc, h, i) {
      if (/^d\d\d$/.test(h)) acc.push(i);
      return acc;
    }, []);

    var out = [];
    data.rows.forEach(function (r) {
      var run = 0, worst = 0;
      dayCols.forEach(function (ci) {
        if (String(r[ci]) === 'A') { run++; worst = Math.max(worst, run); }
        else if (String(r[ci])) run = 0;
      });
      if (worst >= (threshold || 3)) {
        var s = students[String(r[0])] || {};
        out.push({
          studentId: r[0],
          name: s.name_en || '',
          sectionKey: r[1] + '-' + r[2],
          consecutive: worst,
          percent: Number(r[data.headers.indexOf('percent')] || 0)
        });
      }
    });
    return out.sort(function (a, b) { return b.consecutive - a.consecutive; });
  }

  return {
    ensureMonth: ensureMonth_,
    months: months,
    latestMonth: latestMonth,
    forSectionDay: forSectionDay,
    saveSectionDay: saveSectionDay,
    studentMonth: studentMonth,
    studentYear: studentYear,
    monthSummary: monthSummary,
    chronicAbsentees: chronicAbsentees,
    readMonth: readMonth_
  };
})();
