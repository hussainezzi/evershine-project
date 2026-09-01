/**
 * School OS — the permission gate
 *
 * The web app executes with the owner's full authority. That means a single
 * endpoint missing its guard() call exposes the entire school, so every
 * client-callable function in 11_api.gs starts here — no exceptions.
 *
 * guard() checks three things, in order:
 *   1. the session token is valid and unexpired
 *   2. the role holds the permission
 *   3. the requested target falls inside the session's scope   <- the one
 *      everybody forgets, and where real systems leak
 */

var ROLE = {
  PRINCIPAL: 'principal',
  ADMIN: 'office_admin',
  ACCOUNTANT: 'accountant',
  COORDINATOR: 'coordinator',
  CLASS_TEACHER: 'class_teacher',
  TEACHER: 'subject_teacher',
  PARENT: 'parent',
  STUDENT: 'student'
};

/**
 * Role -> permission keys. '*' means every permission.
 * Kept in code for v1; §4 of the architecture brief moves it to Config so a
 * school can vary it without a release.
 */
var PERMISSIONS = {
  principal:      ['*'],
  office_admin:   ['students.read', 'students.write', 'staff.read', 'attendance.read',
                   'attendance.write', 'marks.read', 'fees.read', 'notices.write',
                   'discipline.read', 'reports.read'],
  accountant:     ['students.read', 'fees.read', 'fees.write', 'reports.read'],
  coordinator:    ['students.read', 'attendance.read', 'attendance.write', 'marks.read',
                   'marks.verify', 'discipline.read', 'discipline.review', 'reports.read',
                   'timetable.read'],
  class_teacher:  ['students.read', 'attendance.read', 'attendance.write', 'marks.read',
                   'marks.enter', 'discipline.read', 'discipline.award', 'homework.write'],
  subject_teacher:['students.read', 'attendance.read', 'attendance.write', 'marks.enter',
                   'marks.read', 'discipline.award', 'homework.write'],
  parent:         ['self.child.read'],
  student:        ['self.read']
};

function hasPermission_(role, permission) {
  var list = PERMISSIONS[role] || [];
  return list.indexOf('*') !== -1 || list.indexOf(permission) !== -1;
}

/**
 * Does `target` fall inside this session's data boundary?
 *
 * target may carry: sectionKey ("9-A"), studentId, subjectId.
 */
function inScope_(session, target) {
  if (!target) return true;
  var scope = session.scope || { type: 'self', ids: [] };

  switch (scope.type) {
    case 'school':
      return true;

    case 'wing':
      if (!target.sectionKey) return true;
      var classId = String(target.sectionKey).split('-')[0];
      var cls = Repo.readCached(SS_KEY.CORE, 'Classes').filter(function (c) {
        return String(c.class_id) === classId;
      })[0];
      return !!cls && scope.ids.indexOf(String(cls.wing)) !== -1;

    case 'section':
      return !target.sectionKey || scope.ids.indexOf(String(target.sectionKey)) !== -1;

    case 'subject_pairs':
      // ids look like "9-A:MATH"
      if (target.sectionKey && target.subjectId) {
        return scope.ids.indexOf(target.sectionKey + ':' + target.subjectId) !== -1;
      }
      if (target.sectionKey) {
        return scope.ids.some(function (id) {
          return id.split(':')[0] === target.sectionKey;
        });
      }
      return true;

    case 'children':
      return !target.studentId || scope.ids.indexOf(String(target.studentId)) !== -1;

    case 'self':
      return !target.studentId || String(target.studentId) === String(session.personId);

    default:
      return false;
  }
}

/**
 * The single entry gate. Returns a verified session or throws.
 */
function guard(token, permission, target) {
  var session = Auth.verify(token);

  if (!hasPermission_(session.role, permission)) {
    throw new Error('You do not have access to this (' + permission + ').');
  }
  if (!inScope_(session, target)) {
    throw new Error('That record is outside what your account can see.');
  }
  return session;
}

/**
 * Field-level filtering on the way out. A teacher may read a student record
 * but must not receive the guardian's CNIC or anything fee-related.
 */
var STUDENT_FIELDS = {
  full: null, // everything
  teacher: ['student_id', 'gr_no', 'name_en', 'name_ur', 'father_name', 'gender',
            'photo_file_id', 'medical_notes', 'status'],
  parent: ['student_id', 'gr_no', 'name_en', 'name_ur', 'father_name', 'dob', 'gender',
           'admission_date', 'address', 'area', 'transport_route', 'status']
};

function projectStudent_(row, session) {
  var allow;
  switch (session.role) {
    case ROLE.PRINCIPAL:
    case ROLE.ADMIN:
      allow = STUDENT_FIELDS.full; break;
    case ROLE.PARENT:
      allow = STUDENT_FIELDS.parent; break;
    default:
      allow = STUDENT_FIELDS.teacher;
  }
  if (!allow) return row;
  var out = {};
  allow.forEach(function (f) { if (row[f] !== undefined) out[f] = row[f]; });
  return out;
}

/** Sections this session may act on, as "9-A" keys. */
function sessionSections_(session) {
  var scope = session.scope || { type: 'self', ids: [] };
  var all = Repo.readCached(SS_KEY.CORE, 'Sections').map(function (s) {
    return s.class_id + '-' + s.section;
  });

  switch (scope.type) {
    case 'school':
      return all;
    case 'wing':
      var classes = Repo.readCached(SS_KEY.CORE, 'Classes');
      var inWing = {};
      classes.forEach(function (c) {
        if (scope.ids.indexOf(String(c.wing)) !== -1) inWing[String(c.class_id)] = true;
      });
      return all.filter(function (k) { return inWing[k.split('-')[0]]; });
    case 'section':
      return scope.ids.slice();
    case 'subject_pairs':
      var seen = {};
      scope.ids.forEach(function (id) { seen[id.split(':')[0]] = true; });
      return Object.keys(seen);
    default:
      return [];
  }
}
