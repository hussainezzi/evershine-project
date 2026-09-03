/**
 * School OS — client-callable API
 *
 * Every function here is reachable from the browser via google.script.run,
 * and the web app runs with the owner's full authority. So every single one
 * starts with guard(). There is no exception, and a new endpoint that skips
 * it is a security bug, not a style problem.
 *
 * The client never sends its role — the server derives it from the token.
 */

function doGet(e) {
  return HtmlService.createTemplateFromFile('ui_index')
    .evaluate()
    .setTitle('School OS')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Wraps every endpoint so the browser always receives a shaped result. */
function ok_(data) { return { ok: true, data: data }; }

function call_(fn) {
  try {
    return ok_(fn());
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

// -------------------------------------------------------------------- public

function api_bootstrap() {
  return call_(function () {
    if (!isSetUp_()) return { ready: false };
    var c = config_();
    return {
      ready: true,
      schoolName: c.school_name || 'School',
      schoolAddress: c.school_address || '',
      year: APP.year,
      version: APP.version
    };
  });
}

function api_login(loginId, pin) {
  return call_(function () { return Auth.login(loginId, pin); });
}

function api_session(token) {
  return call_(function () { return Auth.publicSession(Auth.verify(token)); });
}

// ------------------------------------------------------------------ students

function api_sections(token) {
  return call_(function () {
    var s = guard(token, 'students.read');
    return School.sectionsFor(s);
  });
}

function api_roster(token, sectionKey) {
  return call_(function () {
    var s = guard(token, 'students.read', { sectionKey: sectionKey });
    return School.roster(s, sectionKey);
  });
}

function api_searchStudents(token, query) {
  return call_(function () {
    var s = guard(token, 'students.read');
    return School.search(s, query, 60);
  });
}

function api_student(token, studentId) {
  return call_(function () {
    var s = guard(token, 'students.read', { studentId: studentId });
    return School.studentById(s, studentId);
  });
}

function api_dashboard(token) {
  return call_(function () {
    var s = guard(token, 'reports.read');
    return School.dashboard(s);
  });
}

// ---------------------------------------------------------------- attendance

function api_attendanceDay(token, sectionKey, dateStr) {
  return call_(function () {
    var s = guard(token, 'attendance.read', { sectionKey: sectionKey });
    return Attendance.forSectionDay(s, sectionKey, dateStr);
  });
}

function api_saveAttendance(token, sectionKey, dateStr, marks) {
  return call_(function () {
    var s = guard(token, 'attendance.write', { sectionKey: sectionKey });
    return Attendance.saveSectionDay(s, sectionKey, dateStr, marks);
  });
}

function api_attendanceSummary(token, yyyymm) {
  return call_(function () {
    guard(token, 'attendance.read');
    var month = yyyymm || Attendance.latestMonth();
    return {
      summary: Attendance.monthSummary(month),
      months: Attendance.months(),
      chronic: Attendance.chronicAbsentees(month, 3).slice(0, 25)
    };
  });
}

// --------------------------------------------------------------------- exams

function api_exams(token) {
  return call_(function () {
    guard(token, 'marks.read');
    return { exams: Exams.all(), subjects: Exams.subjects() };
  });
}

function api_marksGrid(token, examId, sectionKey, subjectId) {
  return call_(function () {
    var s = guard(token, 'marks.enter', { sectionKey: sectionKey, subjectId: subjectId });
    return Exams.entryGrid(s, examId, sectionKey, subjectId);
  });
}

function api_saveMarks(token, examId, sectionKey, subjectId, entries) {
  return call_(function () {
    var s = guard(token, 'marks.enter', { sectionKey: sectionKey, subjectId: subjectId });
    return Exams.saveMarks(s, examId, sectionKey, subjectId, entries);
  });
}

function api_lockSubject(token, examId, sectionKey, subjectId, locked) {
  return call_(function () {
    var s = guard(token, 'marks.verify', { sectionKey: sectionKey });
    return Exams.lockSubject(s, examId, sectionKey, subjectId, locked);
  });
}

function api_sectionResult(token, examId, sectionKey) {
  return call_(function () {
    var s = guard(token, 'marks.read', { sectionKey: sectionKey });
    return Exams.sectionResult(s, examId, sectionKey);
  });
}

function api_publishExam(token, examId, publish) {
  return call_(function () {
    var s = guard(token, 'marks.verify');
    if (s.role !== ROLE.PRINCIPAL) throw new Error('Only the principal can publish results.');
    return Exams.publish(s, examId, publish);
  });
}

/**
 * Subjects this teacher may enter marks for.
 *
 * Derived from the Assignments table rather than from the scope string, so a
 * class teacher is offered exactly the subjects they actually teach instead of
 * every subject in the catalogue.
 */
function api_mySubjects(token) {
  return call_(function () {
    var s = guard(token, 'marks.enter');
    var subjects = Repo.indexBy(Exams.subjects(), 'subject_id');

    var mine = Repo.readCached(SS_KEY.CORE, 'Assignments').filter(function (a) {
      return String(a.year) === APP.year && String(a.staff_id) === String(s.personId);
    });

    if (mine.length) {
      return mine.map(function (a) {
        return {
          sectionKey: a.class_id + '-' + a.section,
          subjectId: a.subject_id,
          subjectName: (subjects[a.subject_id] || {}).subject_name || a.subject_id
        };
      });
    }

    // Principal and office staff have no assignments of their own — offer every
    // subject that is genuinely taught in the sections they can reach.
    var allowed = sessionSections_(s);
    return Repo.readCached(SS_KEY.CORE, 'Assignments')
      .filter(function (a) {
        return String(a.year) === APP.year &&
               allowed.indexOf(a.class_id + '-' + a.section) !== -1;
      })
      .map(function (a) {
        return {
          sectionKey: a.class_id + '-' + a.section,
          subjectId: a.subject_id,
          subjectName: (subjects[a.subject_id] || {}).subject_name || a.subject_id
        };
      });
  });
}

// ---------------------------------------------------------------------- fees

function api_feeSummary(token) {
  return call_(function () {
    guard(token, 'fees.read');
    return {
      summary: Fees.collectionSummary(),
      dayBook: Fees.dayBook(today_()),
      defaulters: Fees.defaulters(1).slice(0, 40)
    };
  });
}

function api_studentLedger(token, studentId) {
  return call_(function () {
    guard(token, 'fees.read', { studentId: studentId });
    return Fees.studentLedger(studentId);
  });
}

function api_openInvoices(token, studentId) {
  return call_(function () {
    guard(token, 'fees.write', { studentId: studentId });
    return Fees.openInvoices(studentId);
  });
}

function api_recordPayment(token, opts) {
  return call_(function () {
    var s = guard(token, 'fees.write');
    return Fees.recordPayment(s, opts);
  });
}

// ---------------------------------------------------------------- discipline

function api_disciplineCategories(token) {
  return call_(function () {
    var s = guard(token, 'discipline.award');
    return {
      categories: Discipline.categories(),
      limit: Discipline.POINT_LIMIT[s.role] || 0,
      dailyCap: Discipline.DAILY_NEGATIVE_CAP
    };
  });
}

function api_awardPoints(token, opts) {
  return call_(function () {
    var s = guard(token, 'discipline.award', { studentId: opts.studentId });
    return Discipline.award(s, opts);
  });
}

function api_disciplineHistory(token, studentId) {
  return call_(function () {
    guard(token, 'discipline.read', { studentId: studentId });
    return {
      history: Discipline.historyFor(studentId),
      conduct: Discipline.conductFor(studentId)
    };
  });
}

function api_disciplineWatchlist(token) {
  return call_(function () {
    var s = guard(token, 'discipline.read');
    return { watchlist: Discipline.watchlist(s, 20), houses: Discipline.houseTable() };
  });
}

function api_reverseEntry(token, entryId, note) {
  return call_(function () {
    var s = guard(token, 'discipline.review');
    return Discipline.reverse(s, entryId, note);
  });
}

// ------------------------------------------------------- combined dashboard

/**
 * The principal's dashboard used to be three round trips. Each google.script.run
 * call carries roughly a second of fixed overhead regardless of the work done,
 * so collapsing them saves more wall clock than any query tuning.
 */
function api_principalHome(token) {
  return call_(function () {
    var s = guard(token, 'reports.read');
    var month = Attendance.latestMonth();
    return {
      dashboard: School.dashboard(s),
      attendance: {
        summary: month ? Attendance.monthSummary(month) : null,
        chronic: month ? Attendance.chronicAbsentees(month, 3).slice(0, 8) : []
      },
      fees: {
        summary: Fees.collectionSummary(),
        defaulters: Fees.defaulters(1).slice(0, 8)
      }
    };
  });
}

/**
 * Timing probe. Reports how long each hot read takes and whether it was served
 * from cache, so a slow page can be diagnosed instead of guessed at.
 */
function api_perf(token) {
  return call_(function () {
    guard(token, 'reports.read');

    function timed(label, fn) {
      var t = new Date().getTime();
      var n = 0;
      try { var r = fn(); n = (r && r.length) || 0; } catch (e) { n = -1; }
      return { step: label, ms: new Date().getTime() - t, rows: n };
    }

    var steps = [
      timed('Students (cold)', function () { return Repo.readFresh(SS_KEY.CORE, 'Students'); }),
      timed('Students (warm)', function () { return Repo.readCached(SS_KEY.CORE, 'Students'); }),
      timed('Marks', function () { return Repo.readCached(SS_KEY.ACAD, 'Marks'); }),
      timed('Invoices', function () { return Repo.readCached(SS_KEY.FEES, 'Invoices'); }),
      timed('Payments', function () { return Repo.readCached(SS_KEY.FEES, 'Payments'); }),
      timed('Defaulter list', function () { return Fees.defaulters(1); }),
      timed('Attendance summary', function () {
        var m = Attendance.latestMonth();
        return m ? [Attendance.monthSummary(m)] : [];
      })
    ];

    return { steps: steps, totalMs: sum_(steps.map(function (s) { return s.ms; })) };
  });
}

// ------------------------------------------------------------------ notices

function api_notices(token) {
  return call_(function () {
    guard(token, 'students.read');
    return Repo.readCached(SS_KEY.ACAD, 'Notices').slice().reverse();
  });
}

function api_postNotice(token, title, body) {
  return call_(function () {
    var s = guard(token, 'notices.write');
    if (!String(title || '').trim()) throw new Error('Give the notice a title.');
    var notice = {
      notice_id: 'N-' + nextSeq_('notice'),
      ts: nowTs_(),
      title: String(title).slice(0, 160),
      body: String(body || '').slice(0, 2000),
      audience: 'all',
      class_id: '',
      posted_by: s.userId
    };
    Repo.append(SS_KEY.ACAD, 'Notices', [notice]);
    Repo.audit(s, 'notice.post', 'notice', notice.notice_id);
    return notice;
  });
}

// --------------------------------------------------------------- parent view

/**
 * Everything the parent portal needs, in one round trip — a weak connection
 * cannot afford six.
 */
function api_parentHome(token) {
  return call_(function () {
    var s = guard(token, 'self.child.read');
    var exam = Exams.latestPublished();
    var month = Attendance.latestMonth();

    var children = s.scope.ids.map(function (studentId) {
      var student = School.studentById(s, studentId);
      var att = month ? Attendance.studentMonth(studentId, month) : null;
      var ledger = Fees.studentLedger(studentId);

      var result = null;
      if (exam && String(exam.published) === 'yes') {
        try {
          var r = Exams.studentResult(s, exam.exam_id, studentId);
          result = {
            exam: r.exam,
            percent: r.result.percent,
            grade: r.result.grade,
            position: r.result.position,
            classSize: r.classSize,
            status: r.result.status,
            subjects: r.result.subjects
          };
        } catch (e) { result = null; }
      }

      return {
        studentId: studentId,
        name: student.name_en,
        nameUr: student.name_ur,
        sectionKey: student.sectionKey,
        rollNo: student.rollNo,
        attendance: att ? { month: att.month, percent: att.percent,
                            present: att.present, absent: att.absent } : null,
        fees: { outstanding: ledger.outstanding, billed: ledger.billed,
                collected: ledger.collected, rows: ledger.rows.slice(-6) },
        result: result,
        conduct: Discipline.conductFor(studentId),
        recentConduct: Discipline.historyFor(studentId).slice(0, 5)
      };
    });

    return {
      children: children,
      notices: Repo.readCached(SS_KEY.ACAD, 'Notices').slice(-5).reverse(),
      examPublished: exam ? String(exam.published) === 'yes' : false
    };
  });
}
