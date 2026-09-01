/**
 * School OS — exams, marks and results
 *
 * The highest-stakes module in the product. The workflow matters more than the
 * code: enter -> verify -> lock -> compile -> publish. Once a subject is
 * locked, an edit needs a principal override and always writes an audit row.
 */

var Exams = (function () {

  function all() {
    return Repo.readCached(SS_KEY.ACAD, 'ExamDefs').filter(function (e) {
      return String(e.year) === APP.year;
    });
  }

  function byId(examId) {
    return all().filter(function (e) { return String(e.exam_id) === String(examId); })[0];
  }

  function latestPublished() {
    var pub = all().filter(function (e) { return String(e.published) === 'yes'; });
    return pub.length ? pub[pub.length - 1] : (all().length ? all()[all().length - 1] : null);
  }

  function subjects() {
    return Repo.readCached(SS_KEY.CORE, 'Subjects');
  }

  function examSubjects(examId, classId) {
    return Repo.readCached(SS_KEY.ACAD, 'ExamSubjects').filter(function (r) {
      return String(r.exam_id) === String(examId) &&
             (!classId || String(r.class_id) === String(classId));
    });
  }

  function gradeFor(percent) {
    var scheme = Repo.readCached(SS_KEY.ACAD, 'GradeScheme');
    for (var i = 0; i < scheme.length; i++) {
      var g = scheme[i];
      if (percent >= Number(g.min_percent) && percent <= Number(g.max_percent)) {
        return { grade: g.grade, remark: g.remark, gpa: g.gpa };
      }
    }
    return { grade: 'F', remark: 'Fail', gpa: 0 };
  }

  /** Marks entry grid for one (exam, section, subject). */
  function entryGrid(session, examId, sectionKey, subjectId) {
    var parts = sectionKey.split('-');
    var es = examSubjects(examId, parts[0]).filter(function (r) {
      return String(r.subject_id) === String(subjectId);
    })[0];
    if (!es) throw new Error('That subject is not part of this exam for this class.');

    var existing = {};
    var locked = false;
    Repo.readAll(SS_KEY.ACAD, 'Marks').forEach(function (m) {
      if (String(m.exam_id) === String(examId) &&
          String(m.subject_id) === String(subjectId) &&
          String(m.class_id) === parts[0] && String(m.section) === parts[1]) {
        existing[String(m.student_id)] = m;
        if (String(m.locked) === 'yes') locked = true;
      }
    });

    return {
      examId: examId,
      sectionKey: sectionKey,
      subjectId: subjectId,
      maxMarks: Number(es.max_marks),
      passingMarks: Number(es.passing_marks),
      locked: locked,
      students: School.roster(session, sectionKey).map(function (s) {
        var m = existing[s.studentId];
        return {
          studentId: s.studentId,
          rollNo: s.rollNo,
          name: s.name,
          marks: m ? (String(m.is_absent) === 'yes' ? '' : Number(m.marks_obtained)) : '',
          absent: m ? String(m.is_absent) === 'yes' : false
        };
      })
    };
  }

  /**
   * Saves a whole subject grid. entries: [{studentId, marks, absent}]
   * One read, one write — 40 separate writes would time out.
   */
  function saveMarks(session, examId, sectionKey, subjectId, entries) {
    var parts = sectionKey.split('-');
    var es = examSubjects(examId, parts[0]).filter(function (r) {
      return String(r.subject_id) === String(subjectId);
    })[0];
    if (!es) throw new Error('That subject is not part of this exam for this class.');
    var max = Number(es.max_marks);

    entries.forEach(function (e) {
      if (e.absent) return;
      var v = Number(e.marks);
      if (e.marks === '' || e.marks === null) return;
      if (isNaN(v) || v < 0 || v > max) {
        throw new Error('Marks for roll ' + e.rollNo + ' must be between 0 and ' + max + '.');
      }
    });

    return withLock_(function () {
      var rows = Repo.readAll(SS_KEY.ACAD, 'Marks');
      var existing = {};
      rows.forEach(function (m) {
        if (String(m.exam_id) === String(examId) &&
            String(m.subject_id) === String(subjectId) &&
            String(m.class_id) === parts[0] && String(m.section) === parts[1]) {
          existing[String(m.student_id)] = m;
        }
      });

      var isLocked = Object.keys(existing).some(function (k) {
        return String(existing[k].locked) === 'yes';
      });
      if (isLocked && session.role !== ROLE.PRINCIPAL) {
        throw new Error('These marks are locked. Only the principal can change them now.');
      }

      var updates = [], inserts = [];
      entries.forEach(function (e) {
        var payload = {
          exam_id: examId,
          student_id: e.studentId,
          class_id: parts[0],
          section: parts[1],
          subject_id: subjectId,
          marks_obtained: e.absent ? 0 : (e.marks === '' ? '' : Number(e.marks)),
          is_absent: e.absent ? 'yes' : 'no',
          entered_by: session.userId,
          entered_at: nowTs_(),
          locked: isLocked ? 'yes' : 'no'
        };
        var prior = existing[String(e.studentId)];
        if (prior) {
          payload.mark_id = prior.mark_id;
          updates.push(payload);
        } else {
          payload.mark_id = 'MK-' + nextSeq_('mark');
          inserts.push(payload);
        }
      });

      if (updates.length) Repo.updateMany(SS_KEY.ACAD, 'Marks', 'mark_id', updates);
      if (inserts.length) Repo.append(SS_KEY.ACAD, 'Marks', inserts);

      Repo.audit(session, 'marks.save', 'exam_subject',
                 examId + '/' + sectionKey + '/' + subjectId, null,
                 { updated: updates.length, inserted: inserts.length },
                 isLocked ? 'PRINCIPAL OVERRIDE ON LOCKED SUBJECT' : '');

      return { updated: updates.length, inserted: inserts.length, locked: isLocked };
    });
  }

  function lockSubject(session, examId, sectionKey, subjectId, locked) {
    var parts = sectionKey.split('-');
    var patches = Repo.readAll(SS_KEY.ACAD, 'Marks')
      .filter(function (m) {
        return String(m.exam_id) === String(examId) &&
               String(m.subject_id) === String(subjectId) &&
               String(m.class_id) === parts[0] && String(m.section) === parts[1];
      })
      .map(function (m) { return { mark_id: m.mark_id, locked: locked ? 'yes' : 'no' }; });

    if (!patches.length) throw new Error('No marks to lock yet.');
    Repo.updateMany(SS_KEY.ACAD, 'Marks', 'mark_id', patches);
    Repo.audit(session, locked ? 'marks.lock' : 'marks.unlock', 'exam_subject',
               examId + '/' + sectionKey + '/' + subjectId);
    return { count: patches.length, locked: !!locked };
  }

  /**
   * Compiles a section's result: totals, percentage, grade and position,
   * with ties sharing a position.
   */
  function sectionResult(session, examId, sectionKey) {
    var parts = sectionKey.split('-');
    var subs = Repo.indexBy(subjects(), 'subject_id');
    var examSubs = examSubjects(examId, parts[0]);
    var maxByStudentSubject = {};
    examSubs.forEach(function (es) { maxByStudentSubject[es.subject_id] = Number(es.max_marks); });

    var marks = Repo.readAll(SS_KEY.ACAD, 'Marks').filter(function (m) {
      return String(m.exam_id) === String(examId) &&
             String(m.class_id) === parts[0] && String(m.section) === parts[1];
    });
    var byStudent = groupBy_(marks, function (m) { return String(m.student_id); });

    var roster = School.roster(session, sectionKey);
    var rows = roster.map(function (s) {
      var list = byStudent[s.studentId] || [];
      var obtained = 0, total = 0, subjectRows = [], failed = 0;

      examSubs.forEach(function (es) {
        var m = list.filter(function (x) {
          return String(x.subject_id) === String(es.subject_id);
        })[0];
        var got = m ? (String(m.is_absent) === 'yes' ? 0 : Number(m.marks_obtained || 0)) : null;
        var max = Number(es.max_marks);
        if (got !== null) { obtained += got; total += max; }
        if (got !== null && got < Number(es.passing_marks)) failed++;
        subjectRows.push({
          subjectId: es.subject_id,
          subject: (subs[es.subject_id] || {}).subject_name || es.subject_id,
          max: max,
          obtained: got,
          absent: m ? String(m.is_absent) === 'yes' : false,
          passing: Number(es.passing_marks)
        });
      });

      var percent = total ? round2_(obtained * 100 / total) : 0;
      var g = gradeFor(percent);
      return {
        studentId: s.studentId,
        rollNo: s.rollNo,
        name: s.name,
        subjects: subjectRows,
        obtained: obtained,
        total: total,
        percent: percent,
        grade: g.grade,
        remark: g.remark,
        failedSubjects: failed,
        status: failed > 0 ? 'Fail' : 'Pass',
        entered: total > 0
      };
    });

    // Position, with ties sharing a rank.
    var ranked = rows.slice().filter(function (r) { return r.entered; })
                     .sort(function (a, b) { return b.percent - a.percent; });
    var pos = 0, lastPct = null, seen = 0;
    ranked.forEach(function (r) {
      seen++;
      if (r.percent !== lastPct) { pos = seen; lastPct = r.percent; }
      r.position = pos;
    });
    rows.forEach(function (r) { if (!r.entered) r.position = ''; });

    var withMarks = rows.filter(function (r) { return r.entered; });
    return {
      examId: examId,
      exam: (byId(examId) || {}).exam_name || examId,
      sectionKey: sectionKey,
      students: rows,
      stats: {
        counted: withMarks.length,
        average: withMarks.length ? round2_(sum_(withMarks.map(function (r) { return r.percent; })) / withMarks.length) : 0,
        passed: withMarks.filter(function (r) { return r.status === 'Pass'; }).length,
        failed: withMarks.filter(function (r) { return r.status === 'Fail'; }).length,
        highest: withMarks.length ? Math.max.apply(null, withMarks.map(function (r) { return r.percent; })) : 0
      }
    };
  }

  /** One student's report card payload. */
  function studentResult(session, examId, studentId) {
    var enr = Repo.readCached(SS_KEY.CORE, 'Enrollment').filter(function (e) {
      return String(e.student_id) === String(studentId) && String(e.year) === APP.year;
    })[0];
    if (!enr) throw new Error('No enrolment for this student.');

    var sectionKey = enr.class_id + '-' + enr.section;
    var full = sectionResult(
      { role: ROLE.PRINCIPAL, scope: { type: 'school', ids: [] } }, examId, sectionKey);
    var mine = full.students.filter(function (r) {
      return String(r.studentId) === String(studentId);
    })[0];
    if (!mine) throw new Error('No result for this student.');

    var exam = byId(examId) || {};
    var att = Attendance.studentYear(studentId);
    var attPercent = att.length
      ? round2_(sum_(att.map(function (a) { return a.percent; })) / att.length) : 0;

    return {
      exam: exam.exam_name,
      published: String(exam.published) === 'yes',
      sectionKey: sectionKey,
      classSize: full.stats.counted,
      attendancePercent: attPercent,
      conduct: Discipline.conductFor(studentId),
      result: mine
    };
  }

  function publish(session, examId, publish) {
    var e = byId(examId);
    if (!e) throw new Error('Exam not found.');
    Repo.updateRow(SS_KEY.ACAD, 'ExamDefs', e._row, { published: publish ? 'yes' : 'no' });
    Repo.audit(session, publish ? 'exam.publish' : 'exam.unpublish', 'exam', examId);
    return { examId: examId, published: !!publish };
  }

  return {
    all: all,
    byId: byId,
    latestPublished: latestPublished,
    subjects: subjects,
    examSubjects: examSubjects,
    gradeFor: gradeFor,
    entryGrid: entryGrid,
    saveMarks: saveMarks,
    lockSubject: lockSubject,
    sectionResult: sectionResult,
    studentResult: studentResult,
    publish: publish
  };
})();
