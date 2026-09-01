/**
 * School OS — schema
 *
 * Single source of truth for every sheet's columns. The repository layer reads
 * headers from here, so a sheet whose header row has been edited by hand is
 * detected rather than silently misread.
 *
 * Rule: add columns, never rename or reorder them.
 */

var SCHEMA = {
  CORE: {
    Config:      ['key', 'value', 'note'],

    Classes:     ['class_id', 'class_name', 'wing', 'sort_order'],

    Sections:    ['section_id', 'class_id', 'section', 'class_teacher_id', 'room'],

    Subjects:    ['subject_id', 'subject_name', 'short_name', 'applies_to_wing'],

    Staff:       ['staff_id', 'name', 'designation', 'phone', 'cnic', 'qualification',
                  'join_date', 'status'],

    Students:    ['student_id', 'gr_no', 'adm_no', 'name_en', 'name_ur', 'father_name',
                  'b_form_no', 'dob', 'gender', 'religion', 'admission_date', 'status',
                  'address', 'area', 'transport_route', 'house', 'photo_file_id',
                  'previous_school', 'medical_notes'],

    Guardians:   ['guardian_id', 'student_id', 'relation', 'name', 'cnic', 'phone_primary',
                  'phone_alt', 'whatsapp_ok', 'occupation', 'email', 'is_fee_payer'],

    Enrollment:  ['enrollment_id', 'student_id', 'year', 'class_id', 'section', 'roll_no',
                  'result', 'final_percentage'],

    Assignments: ['assignment_id', 'staff_id', 'class_id', 'section', 'subject_id', 'year'],

    Users:       ['user_id', 'person_id', 'person_type', 'login_id', 'display_name',
                  'pin_hash', 'salt', 'role', 'scope_type', 'scope_ids', 'status',
                  'last_login', 'failed_count'],

    AuditLog:    ['ts', 'user_id', 'role', 'action', 'entity', 'entity_id', 'before',
                  'after', 'note']
  },

  ACAD: {
    // Attendance lives in one wide sheet per month: Attendance_2026-08 etc.
    // Columns are built dynamically — see attendanceHeaders_().
    ExamDefs:    ['exam_id', 'exam_name', 'year', 'term', 'starts_on', 'ends_on',
                  'status', 'published'],

    ExamSubjects:['exam_subject_id', 'exam_id', 'class_id', 'subject_id', 'max_marks',
                  'passing_marks', 'weightage'],

    Marks:       ['mark_id', 'exam_id', 'student_id', 'class_id', 'section', 'subject_id',
                  'marks_obtained', 'is_absent', 'entered_by', 'entered_at', 'locked'],

    GradeScheme: ['grade', 'min_percent', 'max_percent', 'remark', 'gpa'],

    Discipline:  ['entry_id', 'ts', 'student_id', 'awarded_by', 'category', 'points',
                  'reason_text', 'reversal_of', 'reviewed_by'],

    Homework:    ['hw_id', 'ts', 'class_id', 'section', 'subject_id', 'due_date',
                  'detail', 'posted_by'],

    Notices:     ['notice_id', 'ts', 'title', 'body', 'audience', 'class_id', 'posted_by']
  },

  FEES: {
    FeeHeads:    ['head_id', 'head_name', 'frequency', 'concession_eligible', 'sort_order'],

    FeeStructure:['structure_id', 'class_id', 'head_id', 'amount', 'year'],

    Concessions: ['concession_id', 'student_id', 'type', 'percent', 'approved_by',
                  'valid_from', 'valid_to', 'note'],

    Invoices:    ['invoice_id', 'student_id', 'year', 'month', 'issue_date', 'due_date',
                  'gross_amount', 'concession_amount', 'late_fine', 'net_amount', 'status'],

    Payments:    ['payment_id', 'invoice_id', 'student_id', 'date', 'amount', 'mode',
                  'reference_no', 'received_by', 'receipt_no', 'reversal_of', 'note']
  }
};

/** Wide attendance grid: one row per student per month, one column per day. */
function attendanceHeaders_(yyyymm) {
  var h = ['student_id', 'class_id', 'section', 'roll_no'];
  var n = daysInMonth_(yyyymm);
  for (var d = 1; d <= n; d++) h.push('d' + pad_(d, 2));
  h.push('present', 'absent', 'leave', 'percent');
  return h;
}

function attendanceSheetName_(yyyymm) {
  return 'Attendance_' + yyyymm;
}

/**
 * Creates any missing sheet in a spreadsheet and writes its header row.
 * Idempotent — safe to call on every deploy, which is how migrations run.
 */
function ensureSheets_(ssKey) {
  var ss = ss_(ssKey);
  var defs = SCHEMA[ssKey];
  Object.keys(defs).forEach(function (name) {
    ensureSheet_(ss, name, defs[name]);
  });
  var def = ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0) ss.deleteSheet(def);
}

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#e8eee9');
    sh.protect().setDescription('header').setWarningOnly(true);
    return sh;
  }
  // Additive migration: append any column the code knows about and the sheet lacks.
  var existing = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0]
                   .filter(String);
  var missing = headers.filter(function (h) { return existing.indexOf(h) === -1; });
  if (missing.length) {
    sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
  return sh;
}
