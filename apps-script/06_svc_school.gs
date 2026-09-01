/**
 * School OS — students, classes and school-wide figures.
 */

var School = (function () {

  function sections() {
    var classes = Repo.indexBy(Repo.readCached(SS_KEY.CORE, 'Classes'), 'class_id');
    return Repo.readCached(SS_KEY.CORE, 'Sections').map(function (s) {
      var c = classes[s.class_id] || {};
      return {
        key: s.class_id + '-' + s.section,
        classId: String(s.class_id),
        section: String(s.section),
        className: c.class_name || s.class_id,
        wing: c.wing || '',
        classTeacherId: s.class_teacher_id || '',
        room: s.room || ''
      };
    });
  }

  function sectionsFor(session) {
    var allowed = sessionSections_(session);
    return sections().filter(function (s) { return allowed.indexOf(s.key) !== -1; });
  }

  function enrollmentsFor(sectionKey) {
    var parts = String(sectionKey).split('-');
    return Repo.readCached(SS_KEY.CORE, 'Enrollment').filter(function (e) {
      return String(e.year) === APP.year &&
             String(e.class_id) === parts[0] &&
             String(e.section) === parts[1];
    });
  }

  /** Roster for one section, sorted by roll number. */
  function roster(session, sectionKey) {
    var students = Repo.indexBy(Repo.readCached(SS_KEY.CORE, 'Students'), 'student_id');
    return enrollmentsFor(sectionKey)
      .map(function (e) {
        var s = students[e.student_id] || {};
        return {
          studentId: e.student_id,
          rollNo: Number(e.roll_no),
          name: s.name_en || '(unknown)',
          nameUr: s.name_ur || '',
          fatherName: s.father_name || '',
          gender: s.gender || '',
          grNo: s.gr_no || ''
        };
      })
      .sort(function (a, b) { return a.rollNo - b.rollNo; });
  }

  function studentById(session, studentId) {
    var s = Repo.readCached(SS_KEY.CORE, 'Students').filter(function (r) {
      return String(r.student_id) === String(studentId);
    })[0];
    if (!s) throw new Error('Student not found.');

    var enr = Repo.readCached(SS_KEY.CORE, 'Enrollment').filter(function (e) {
      return String(e.student_id) === String(studentId) && String(e.year) === APP.year;
    })[0] || {};

    var out = projectStudent_(s, session);
    out.classId = enr.class_id || '';
    out.section = enr.section || '';
    out.rollNo = enr.roll_no || '';
    out.sectionKey = enr.class_id ? enr.class_id + '-' + enr.section : '';

    if (session.role === ROLE.PRINCIPAL || session.role === ROLE.ADMIN) {
      out.guardians = Repo.readCached(SS_KEY.CORE, 'Guardians').filter(function (g) {
        return String(g.student_id) === String(studentId);
      });
    }
    return out;
  }

  /** Server-side search — the browser never receives the whole student table. */
  function search(session, query, limit) {
    var q = String(query || '').trim().toLowerCase();
    var allowed = sessionSections_(session);
    var enrByStudent = {};
    Repo.readCached(SS_KEY.CORE, 'Enrollment').forEach(function (e) {
      if (String(e.year) === APP.year) enrByStudent[e.student_id] = e;
    });

    var out = [];
    var students = Repo.readCached(SS_KEY.CORE, 'Students');
    for (var i = 0; i < students.length && out.length < (limit || 50); i++) {
      var s = students[i];
      var e = enrByStudent[s.student_id];
      if (!e) continue;
      var key = e.class_id + '-' + e.section;
      if (allowed.indexOf(key) === -1) continue;
      if (q && String(s.name_en).toLowerCase().indexOf(q) === -1 &&
               String(s.gr_no).toLowerCase().indexOf(q) === -1 &&
               String(s.father_name).toLowerCase().indexOf(q) === -1) continue;

      out.push({
        studentId: s.student_id,
        grNo: s.gr_no,
        name: s.name_en,
        fatherName: s.father_name,
        sectionKey: key,
        rollNo: e.roll_no,
        status: s.status
      });
    }
    return out;
  }

  /** Principal dashboard figures. Cached — this is read constantly. */
  function dashboard(session) {
    var hit = cacheGet_('dashboard');
    if (hit) return hit;

    var students = Repo.readCached(SS_KEY.CORE, 'Students');
    var active = students.filter(function (s) { return String(s.status) === 'active'; });
    var staff = Repo.readCached(SS_KEY.CORE, 'Staff').filter(function (s) {
      return String(s.status) === 'active';
    });

    var month = Attendance.latestMonth();
    var att = month ? Attendance.monthSummary(month) : { percent: 0, month: '' };
    var fees = Fees.collectionSummary();
    var exam = Exams.latestPublished();

    var out = {
      students: active.length,
      staff: staff.length,
      sections: School.sections().length,
      attendancePercent: att.percent,
      attendanceMonth: att.month,
      feesBilled: fees.billed,
      feesCollected: fees.collected,
      feesOutstanding: fees.outstanding,
      collectionRate: fees.rate,
      defaulters: fees.defaulters,
      latestExam: exam ? exam.exam_name : '—',
      generatedAt: nowTs_()
    };
    cachePut_('dashboard', out, 300);
    return out;
  }

  return {
    sections: sections,
    sectionsFor: sectionsFor,
    roster: roster,
    studentById: studentById,
    search: search,
    dashboard: dashboard,
    enrollmentsFor: enrollmentsFor
  };
})();
