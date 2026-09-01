/**
 * School OS — discipline points
 *
 * Append-only merit/demerit ledger. Unbounded, this feature becomes a weapon
 * within a month and parents start arriving at the office, so most of the
 * design here is guardrails: point caps by role, a daily negative budget per
 * teacher, mandatory reasons past a threshold, and reversal instead of
 * deletion.
 */

var Discipline = (function () {

  /** Maximum absolute points a role may award in one entry. */
  var POINT_LIMIT = {
    subject_teacher: 5,
    class_teacher: 10,
    coordinator: 20,
    office_admin: 10,
    principal: 100
  };

  /** Negative points one member of staff may issue per day, across all students. */
  var DAILY_NEGATIVE_CAP = 15;

  var CATEGORIES = [
    { id: 'homework',      label: 'Homework not done',      points: -2 },
    { id: 'late',          label: 'Late to class',          points: -1 },
    { id: 'uniform',       label: 'Uniform / grooming',     points: -1 },
    { id: 'disruption',    label: 'Disrupting the class',   points: -3 },
    { id: 'disrespect',    label: 'Disrespect to staff',    points: -5 },
    { id: 'fighting',      label: 'Fighting',               points: -8 },
    { id: 'participation', label: 'Excellent participation', points: 3 },
    { id: 'helping',       label: 'Helped a classmate',     points: 3 },
    { id: 'homework_good', label: 'Outstanding homework',   points: 2 },
    { id: 'representing',  label: 'Represented the school', points: 5 }
  ];

  function categories() { return CATEGORIES; }

  function entries(filterFn) {
    var rows = Repo.readCached(SS_KEY.ACAD, 'Discipline', 300);
    return filterFn ? rows.filter(filterFn) : rows;
  }

  /** Reversed entries and their reversals both drop out of the total. */
  function netEntriesFor(studentId) {
    var mine = entries(function (e) { return String(e.student_id) === String(studentId); });
    var reversed = {};
    mine.forEach(function (e) {
      if (String(e.reversal_of || '')) reversed[String(e.reversal_of)] = true;
    });
    return mine.filter(function (e) {
      return !String(e.reversal_of || '') && !reversed[String(e.entry_id)];
    });
  }

  function totalFor(studentId) {
    return sum_(netEntriesFor(studentId).map(function (e) { return Number(e.points || 0); }));
  }

  /** Net points map the conduct grade printed on the report card. */
  function conductFor(studentId) {
    var net = totalFor(studentId);
    var grade = net >= 20 ? 'A' : net >= 5 ? 'B' : net >= -5 ? 'C' : net >= -20 ? 'D' : 'E';
    var remark = { A: 'Exemplary', B: 'Good', C: 'Satisfactory',
                   D: 'Needs improvement', E: 'Unsatisfactory' }[grade];
    return { points: net, grade: grade, remark: remark };
  }

  function historyFor(studentId) {
    var staff = Repo.indexBy(Repo.readCached(SS_KEY.CORE, 'Staff'), 'staff_id');
    return entries(function (e) { return String(e.student_id) === String(studentId); })
      .map(function (e) {
        return {
          entryId: e.entry_id,
          ts: e.ts,
          category: e.category,
          points: Number(e.points || 0),
          reason: e.reason_text,
          by: (staff[e.awarded_by] || {}).name || e.awarded_by,
          reversalOf: e.reversal_of || '',
          reviewedBy: e.reviewed_by || ''
        };
      })
      .sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); });
  }

  function negativeIssuedToday_(staffId) {
    var d = today_();
    return Math.abs(sum_(
      entries(function (e) {
        return String(e.awarded_by) === String(staffId) &&
               String(e.ts).indexOf(d) === 0 &&
               Number(e.points || 0) < 0;
      }).map(function (e) { return Number(e.points || 0); })
    ));
  }

  /** Awards points, subject to every guardrail above. */
  function award(session, opts) {
    var points = Number(opts.points);
    if (isNaN(points) || points === 0) throw new Error('Choose how many points to give.');

    var limit = POINT_LIMIT[session.role] || 0;
    if (Math.abs(points) > limit) {
      throw new Error('Your account can award at most ' + limit + ' points in one entry.');
    }
    if (points <= -3 && !String(opts.reason || '').trim()) {
      throw new Error('Please write a short reason for anything beyond -2 points.');
    }
    if (points < 0) {
      var issued = negativeIssuedToday_(session.personId);
      if (issued + Math.abs(points) > DAILY_NEGATIVE_CAP) {
        throw new Error('You have reached today\'s limit of ' + DAILY_NEGATIVE_CAP +
                        ' negative points. Speak to the coordinator if more is needed.');
      }
    }

    var entry = {
      entry_id: 'DP-' + nextSeq_('discipline'),
      ts: nowTs_(),
      student_id: opts.studentId,
      awarded_by: session.personId,
      category: opts.category || 'other',
      points: points,
      reason_text: String(opts.reason || '').slice(0, 300),
      reversal_of: '',
      reviewed_by: ''
    };
    Repo.append(SS_KEY.ACAD, 'Discipline', [entry]);
    Repo.audit(session, 'discipline.award', 'student', opts.studentId, null, entry);

    return {
      entryId: entry.entry_id,
      newTotal: totalFor(opts.studentId),
      notifyParent: points <= -3
    };
  }

  /**
   * Corrects a wrong entry by appending a reversal. The original stays
   * visible to admin — nothing is ever deleted.
   */
  function reverse(session, entryId, note) {
    var original = entries(function (e) {
      return String(e.entry_id) === String(entryId);
    })[0];
    if (!original) throw new Error('Entry not found.');
    if (String(original.reversal_of || '')) throw new Error('That is already a reversal.');

    var entry = {
      entry_id: 'DP-' + nextSeq_('discipline'),
      ts: nowTs_(),
      student_id: original.student_id,
      awarded_by: session.personId,
      category: original.category,
      points: -Number(original.points || 0),
      reason_text: 'Reversal: ' + String(note || ''),
      reversal_of: original.entry_id,
      reviewed_by: session.personId
    };
    Repo.append(SS_KEY.ACAD, 'Discipline', [entry]);
    Repo.audit(session, 'discipline.reverse', 'entry', entryId, original, entry);
    return { entryId: entry.entry_id, newTotal: totalFor(original.student_id) };
  }

  /** Students trending sharply negative — the actual pastoral-care value. */
  function watchlist(session, limit) {
    var allowed = sessionSections_(session);
    var students = Repo.indexBy(Repo.readCached(SS_KEY.CORE, 'Students'), 'student_id');
    var enr = {};
    Repo.readCached(SS_KEY.CORE, 'Enrollment').forEach(function (e) {
      if (String(e.year) === APP.year) enr[e.student_id] = e;
    });

    var totals = {};
    entries().forEach(function (e) {
      totals[e.student_id] = (totals[e.student_id] || 0) + Number(e.points || 0);
    });

    return Object.keys(totals)
      .map(function (sid) {
        var e = enr[sid] || {};
        return {
          studentId: sid,
          name: (students[sid] || {}).name_en || '',
          sectionKey: e.class_id ? e.class_id + '-' + e.section : '',
          points: totals[sid]
        };
      })
      .filter(function (r) {
        return r.points < 0 && allowed.indexOf(r.sectionKey) !== -1;
      })
      .sort(function (a, b) { return a.points - b.points; })
      .slice(0, limit || 15);
  }

  /** House points, which schools love for assembly announcements. */
  function houseTable() {
    var totals = {};
    entries().forEach(function (e) {
      totals[e.student_id] = (totals[e.student_id] || 0) + Number(e.points || 0);
    });
    var byHouse = {};
    Repo.readCached(SS_KEY.CORE, 'Students').forEach(function (s) {
      var h = String(s.house || '').trim();
      if (!h) return;
      byHouse[h] = (byHouse[h] || 0) + (totals[s.student_id] || 0);
    });
    return Object.keys(byHouse).map(function (h) {
      return { house: h, points: byHouse[h] };
    }).sort(function (a, b) { return b.points - a.points; });
  }

  return {
    categories: categories,
    entries: entries,
    totalFor: totalFor,
    conductFor: conductFor,
    historyFor: historyFor,
    award: award,
    reverse: reverse,
    watchlist: watchlist,
    houseTable: houseTable,
    POINT_LIMIT: POINT_LIMIT,
    DAILY_NEGATIVE_CAP: DAILY_NEGATIVE_CAP
  };
})();
