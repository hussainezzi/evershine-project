/**
 * School OS — demo school seeder
 *
 * Creates a complete, believable 600-student Karachi school: staff, students,
 * guardians, five months of attendance, two exams with marks, six months of
 * fee invoices and payments, and a discipline ledger.
 *
 * Runs in stages so no single execution approaches the 6-minute limit, and
 * records its progress — re-running continues from where it stopped.
 *
 * Academic year 2026-27 runs April 2026 to March 2027 (the Sindh pattern),
 * so on today's date the school is five months into the year.
 */

// ------------------------------------------------------------ demo constants

var DEMO = {
  schoolName: 'Al-Noor Public School',
  schoolAddress: 'Block 13-D, Gulshan-e-Iqbal, Karachi',
  phone: '021-34567890',
  pin: '1234',
  attendanceMonths: ['2026-04', '2026-05', '2026-07', '2026-08'],
  feeMonths: ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'],
  studentsPerSection: 30,
  houses: ['Iqbal', 'Jinnah', 'Liaquat', 'Sir Syed']
};

var MALE_NAMES = ['Ahmed', 'Ali', 'Hassan', 'Hussain', 'Bilal', 'Usman', 'Umar', 'Zain',
  'Hamza', 'Saad', 'Talha', 'Ibrahim', 'Yousuf', 'Abdullah', 'Faizan', 'Danish', 'Rehan',
  'Arsalan', 'Shahzaib', 'Owais', 'Junaid', 'Kashif', 'Adnan', 'Imran', 'Waqas', 'Noman',
  'Fahad', 'Salman', 'Asad', 'Haris', 'Sameer', 'Tahir', 'Zohaib', 'Mudassir', 'Farhan'];

var FEMALE_NAMES = ['Ayesha', 'Fatima', 'Zainab', 'Maryam', 'Hira', 'Sana', 'Amna', 'Iqra',
  'Rabia', 'Sadia', 'Nimra', 'Areeba', 'Laiba', 'Eman', 'Anum', 'Mahnoor', 'Kiran', 'Sidra',
  'Bushra', 'Nida', 'Saba', 'Hina', 'Komal', 'Rida', 'Mehwish', 'Zoya', 'Alina', 'Warda',
  'Faiza', 'Sumaiya', 'Aiman', 'Tooba', 'Javeria', 'Shanzay', 'Minahil'];

var FAMILY_NAMES = ['Khan', 'Ahmed', 'Ali', 'Siddiqui', 'Qureshi', 'Sheikh', 'Malik', 'Baig',
  'Ansari', 'Farooqui', 'Hashmi', 'Rizvi', 'Naqvi', 'Abbasi', 'Chaudhry', 'Memon', 'Shaikh',
  'Bhatti', 'Awan', 'Raza', 'Hussain', 'Iqbal', 'Aslam', 'Nawaz', 'Jamali'];

var AREAS = ['Gulshan-e-Iqbal', 'North Nazimabad', 'Gulistan-e-Johar', 'Korangi', 'Landhi',
  'Malir', 'Nazimabad', 'F.B. Area', 'Shah Faisal Colony', 'Liaquatabad', 'New Karachi',
  'Buffer Zone', 'Surjani Town', 'Orangi Town', 'Baldia Town'];

var OCCUPATIONS = ['Shopkeeper', 'Driver', 'Government servant', 'Teacher', 'Tailor',
  'Electrician', 'Clerk', 'Small trader', 'Factory worker', 'Mechanic', 'Salesman',
  'Security guard', 'Accountant', 'Plumber', 'Bank employee'];

// -------------------------------------------------------- deterministic random

var _rndState = 20260901;
function rnd_() {
  _rndState = (_rndState * 1103515245 + 12345) % 2147483648;
  return _rndState / 2147483648;
}
function rndInt_(min, max) { return min + Math.floor(rnd_() * (max - min + 1)); }
function rndPick_(arr) { return arr[Math.floor(rnd_() * arr.length)]; }
function resetRnd_() { _rndState = 20260901; }

// ---------------------------------------------------------------- orchestrator

var SEED_STAGE_NAMES = ['files', 'structure', 'staff', 'students', 'users',
                        'attendance', 'exams', 'fees', 'discipline'];

/** Function declarations are hoisted into the shared global scope, so building
 *  this inside a call always resolves them. */
function seedStages_() {
  return [
    ['files',      seed_createFiles_],
    ['structure',  seed_academicStructure_],
    ['staff',      seed_staff_],
    ['students',   seed_students_],
    ['users',      seed_users_],
    ['attendance', seed_attendance_],
    ['exams',      seed_exams_],
    ['fees',       seed_fees_],
    ['discipline', seed_discipline_]
  ];
}

/**
 * Stop starting new stages after this much wall clock, leaving headroom inside
 * the 6-minute cap for the stage already running to finish.
 */
var SEED_BUDGET_MS = 4 * 60 * 1000;

/**
 * Run this once from the Apps Script editor.
 *
 * Each stage records its own completion, so this is safe to re-run and safe to
 * be resumed by a trigger. If the budget runs out with stages left, it schedules
 * itself to continue in a minute and returns — the same checkpoint-and-resume
 * pattern every school-wide job in this system uses.
 */
function setupAndSeedDemoSchool() {
  var started = new Date().getTime();
  var log = [];
  resetRnd_();

  var stages = seedStages_();
  var done = Number(props_().getProperty(PROP.SEED_STAGE) || 0);

  while (done < stages.length) {
    if (new Date().getTime() - started > SEED_BUDGET_MS) {
      scheduleSeedContinuation_();
      var paused = {
        status: 'paused — will continue automatically in about a minute',
        completed: done + ' of ' + stages.length + ' stages',
        nextStage: stages[done][0],
        stages: log
      };
      console.log(JSON.stringify(paused, null, 2));
      return paused;
    }

    var name = stages[done][0];
    var stageStart = new Date().getTime();
    console.log('seeding stage ' + (done + 1) + '/' + stages.length + ': ' + name);

    var result = stages[done][1]();

    done++;
    props_().setProperty(PROP.SEED_STAGE, String(done));
    log.push(name + ': ' + result + ' (' +
             Math.round((new Date().getTime() - stageStart) / 1000) + 's)');
  }

  clearSeedTriggers_();
  bumpCache_();

  var out = {
    status: 'complete',
    school: DEMO.schoolName,
    year: APP.year,
    stages: log,
    logins: showDemoLogins(),
    coreSheet: 'https://docs.google.com/spreadsheets/d/' + props_().getProperty(PROP.CORE_ID),
    academicsSheet: 'https://docs.google.com/spreadsheets/d/' + props_().getProperty(PROP.ACAD_ID),
    feesSheet: 'https://docs.google.com/spreadsheets/d/' + props_().getProperty(PROP.FEES_ID),
    folder: 'https://drive.google.com/drive/folders/' + props_().getProperty(PROP.ROOT_FOLDER)
  };
  console.log(JSON.stringify(out, null, 2));
  return out;
}

function scheduleSeedContinuation_() {
  clearSeedTriggers_();
  ScriptApp.newTrigger('setupAndSeedDemoSchool').timeBased().after(60 * 1000).create();
}

function clearSeedTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'setupAndSeedDemoSchool') ScriptApp.deleteTrigger(t);
  });
}

/** Where has the seed got to? Run this any time to check. */
function seedStatus() {
  var done = Number(props_().getProperty(PROP.SEED_STAGE) || 0);
  var pending = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'setupAndSeedDemoSchool';
  }).length;

  var out = {
    completedStages: done + ' of ' + SEED_STAGE_NAMES.length,
    nextStage: done < SEED_STAGE_NAMES.length ? SEED_STAGE_NAMES[done] : '— finished —',
    continuationScheduled: pending > 0,
    setUp: isSetUp_()
  };

  if (isSetUp_()) {
    out.rowCounts = {
      students: countRows_(SS_KEY.CORE, 'Students'),
      users: countRows_(SS_KEY.CORE, 'Users'),
      marks: countRows_(SS_KEY.ACAD, 'Marks'),
      invoices: countRows_(SS_KEY.FEES, 'Invoices'),
      payments: countRows_(SS_KEY.FEES, 'Payments'),
      discipline: countRows_(SS_KEY.ACAD, 'Discipline')
    };
  }
  console.log(JSON.stringify(out, null, 2));
  return out;
}

function countRows_(ssKey, name) {
  var sh = ss_(ssKey).getSheetByName(name);
  return sh ? Math.max(0, sh.getLastRow() - 1) : 0;
}

/** Wipes the seed marker so the next run starts over (files are NOT deleted). */
function resetSeedProgress() {
  props_().deleteProperty(PROP.SEED_STAGE);
  clearSeedTriggers_();
  return 'seed progress cleared';
}

// -------------------------------------------------------------- stage 1: files

function seed_createFiles_() {
  var p = props_();
  if (p.getProperty(PROP.CORE_ID)) return 'already created';

  var parentId = '1m3qcyPHZyGEjZNpvIEzwwx3fWiWHkvtk'; // "Evershine Project"
  var parent;
  try {
    parent = DriveApp.getFolderById(parentId);
  } catch (e) {
    parent = DriveApp.getRootFolder();
  }

  var root = parent.createFolder(DEMO.schoolName + ' — School OS');
  var data = root.createFolder('01 Data');
  root.createFolder('02 Templates');
  var generated = root.createFolder('03 Generated');
  generated.createFolder('ReportCards');
  generated.createFolder('Challans');
  generated.createFolder('Certificates');
  root.createFolder('04 Student Files');
  root.createFolder('05 Notices');
  root.createFolder('_Backups');

  function make(name) {
    var ss = SpreadsheetApp.create(name);
    DriveApp.getFileById(ss.getId()).moveTo(data);
    return ss.getId();
  }

  p.setProperty(PROP.ROOT_FOLDER, root.getId());
  p.setProperty(PROP.CORE_ID, make('SchoolOS — Core'));
  p.setProperty(PROP.ACAD_ID, make('SchoolOS — Academics ' + APP.year));
  p.setProperty(PROP.FEES_ID, make('SchoolOS — Fees ' + APP.year));

  ensureSheets_(SS_KEY.CORE);
  ensureSheets_(SS_KEY.ACAD);
  ensureSheets_(SS_KEY.FEES);

  Repo.append(SS_KEY.CORE, 'Config', [
    { key: 'school_name', value: DEMO.schoolName, note: 'Printed on every document' },
    { key: 'school_address', value: DEMO.schoolAddress, note: '' },
    { key: 'school_phone', value: DEMO.phone, note: '' },
    { key: 'academic_year', value: APP.year, note: 'April to March' },
    { key: 'currency', value: 'PKR', note: '' },
    { key: 'late_fine_per_day', value: '20', note: 'Rs per day after due date' },
    { key: 'fee_due_day', value: '10', note: 'Day of month fees fall due' },
    { key: 'board', value: 'BSEK Karachi', note: 'Board for secondary classes' }
  ]);

  return 'created 3 spreadsheets + folder tree';
}

// ---------------------------------------------------- stage 2: school structure

function seed_academicStructure_() {
  ['Classes', 'Sections', 'Subjects'].forEach(function (n) { Repo.clearBody(SS_KEY.CORE, n); });
  Repo.clearBody(SS_KEY.ACAD, 'GradeScheme');
  ['FeeHeads', 'FeeStructure'].forEach(function (n) { Repo.clearBody(SS_KEY.FEES, n); });

  var classes = [], sections = [];
  for (var n = 1; n <= 10; n++) {
    var wing = n <= 5 ? 'Primary' : (n <= 8 ? 'Middle' : 'Secondary');
    classes.push({
      class_id: String(n),
      class_name: 'Class ' + n,
      wing: wing,
      sort_order: n
    });
    ['A', 'B'].forEach(function (sec) {
      sections.push({
        section_id: n + '-' + sec,
        class_id: String(n),
        section: sec,
        class_teacher_id: '',
        room: 'R-' + pad_(n, 2) + sec
      });
    });
  }
  Repo.append(SS_KEY.CORE, 'Classes', classes);
  Repo.append(SS_KEY.CORE, 'Sections', sections);

  Repo.append(SS_KEY.CORE, 'Subjects', [
    { subject_id: 'ENG', subject_name: 'English',        short_name: 'Eng',  applies_to_wing: 'all' },
    { subject_id: 'URD', subject_name: 'Urdu',           short_name: 'Urd',  applies_to_wing: 'all' },
    { subject_id: 'MATH', subject_name: 'Mathematics',   short_name: 'Math', applies_to_wing: 'all' },
    { subject_id: 'ISL', subject_name: 'Islamiat',       short_name: 'Isl',  applies_to_wing: 'all' },
    { subject_id: 'SCI', subject_name: 'General Science', short_name: 'Sci', applies_to_wing: 'Primary,Middle' },
    { subject_id: 'SST', subject_name: 'Social Studies', short_name: 'SSt',  applies_to_wing: 'Primary,Middle' },
    { subject_id: 'COMP', subject_name: 'Computer Science', short_name: 'Comp', applies_to_wing: 'Middle,Secondary' },
    { subject_id: 'PHY', subject_name: 'Physics',        short_name: 'Phy',  applies_to_wing: 'Secondary' },
    { subject_id: 'CHEM', subject_name: 'Chemistry',     short_name: 'Chem', applies_to_wing: 'Secondary' },
    { subject_id: 'BIO', subject_name: 'Biology',        short_name: 'Bio',  applies_to_wing: 'Secondary' }
  ]);

  // Standard Pakistani board bands — editable per school.
  Repo.append(SS_KEY.ACAD, 'GradeScheme', [
    { grade: 'A1', min_percent: 80, max_percent: 100, remark: 'Outstanding',   gpa: 4.0 },
    { grade: 'A',  min_percent: 70, max_percent: 79.99, remark: 'Excellent',   gpa: 3.7 },
    { grade: 'B',  min_percent: 60, max_percent: 69.99, remark: 'Very good',   gpa: 3.3 },
    { grade: 'C',  min_percent: 50, max_percent: 59.99, remark: 'Good',        gpa: 2.7 },
    { grade: 'D',  min_percent: 40, max_percent: 49.99, remark: 'Fair',        gpa: 2.0 },
    { grade: 'E',  min_percent: 33, max_percent: 39.99, remark: 'Pass',        gpa: 1.0 },
    { grade: 'F',  min_percent: 0,  max_percent: 32.99, remark: 'Fail',        gpa: 0 }
  ]);

  Repo.append(SS_KEY.FEES, 'FeeHeads', [
    { head_id: 'TUITION',   head_name: 'Tuition fee',     frequency: 'monthly', concession_eligible: 'yes', sort_order: 1 },
    { head_id: 'ADMISSION', head_name: 'Admission fee',   frequency: 'once',    concession_eligible: 'no',  sort_order: 2 },
    { head_id: 'ANNUAL',    head_name: 'Annual charges',  frequency: 'annual',  concession_eligible: 'no',  sort_order: 3 },
    { head_id: 'EXAM',      head_name: 'Examination fee', frequency: 'term',    concession_eligible: 'no',  sort_order: 4 },
    { head_id: 'TRANSPORT', head_name: 'Transport fee',   frequency: 'monthly', concession_eligible: 'no',  sort_order: 5 }
  ]);

  // Monthly tuition rises with the class — Rs 1,500 in Class 1 to Rs 3,300 in Class 10.
  var structure = [];
  for (var c = 1; c <= 10; c++) {
    structure.push({
      structure_id: 'FS-' + c + '-TUITION',
      class_id: String(c),
      head_id: 'TUITION',
      amount: 1300 + c * 200,
      year: APP.year
    });
  }
  Repo.append(SS_KEY.FEES, 'FeeStructure', structure);

  return classes.length + ' classes, ' + sections.length + ' sections, 10 subjects';
}

// ------------------------------------------------------------- stage 3: staff

function seed_staff_() {
  ['Staff', 'Assignments'].forEach(function (n) { Repo.clearBody(SS_KEY.CORE, n); });

  var staff = [], assignments = [];
  var seq = 0;

  function addStaff(name, designation) {
    seq++;
    var id = staffId_(seq);
    staff.push({
      staff_id: id,
      name: name,
      designation: designation,
      phone: '0300' + pad_(1000000 + seq * 137, 7),
      cnic: '42101-' + pad_(rndInt_(1000000, 9999999), 7) + '-' + rndInt_(1, 9),
      qualification: rndPick_(['M.A.', 'M.Sc.', 'B.Ed.', 'M.Ed.', 'B.A.', 'B.Sc.']),
      join_date: '20' + rndInt_(14, 24) + '-0' + rndInt_(1, 9) + '-' + pad_(rndInt_(1, 28), 2),
      status: 'active'
    });
    return id;
  }

  var principalId = addStaff('Mr. Abdul Rasheed Siddiqui', 'Principal');
  var adminId = addStaff('Mrs. Shazia Parveen', 'Office Administrator');
  addStaff('Mr. Nadeem Akhtar', 'Office Assistant');
  var accountantId = addStaff('Mr. Muhammad Yaqoob', 'Accountant');
  var coordPrimaryId = addStaff('Mrs. Farhana Iqbal', 'Primary Coordinator');
  var coordSeniorId = addStaff('Mr. Tariq Mehmood', 'Senior Section Coordinator');

  // 20 class teachers, one per section, plus subject specialists.
  var sections = Repo.readAll(SS_KEY.CORE, 'Sections');
  var classTeacherOf = {};
  sections.forEach(function (sec) {
    var female = rnd_() < 0.65;
    var name = (female ? 'Ms. ' : 'Mr. ') +
               rndPick_(female ? FEMALE_NAMES : MALE_NAMES) + ' ' + rndPick_(FAMILY_NAMES);
    var id = addStaff(name, 'Class Teacher');
    classTeacherOf[sec.section_id] = id;
  });

  var specialists = [];
  for (var i = 0; i < 10; i++) {
    var female2 = rnd_() < 0.5;
    specialists.push(addStaff(
      (female2 ? 'Ms. ' : 'Mr. ') + rndPick_(female2 ? FEMALE_NAMES : MALE_NAMES) +
      ' ' + rndPick_(FAMILY_NAMES), 'Subject Teacher'));
  }

  Repo.append(SS_KEY.CORE, 'Staff', staff);

  // Point each section at its class teacher.
  Repo.updateMany(SS_KEY.CORE, 'Sections', 'section_id', sections.map(function (sec) {
    return { section_id: sec.section_id, class_teacher_id: classTeacherOf[sec.section_id] };
  }));

  // Teaching assignments: the class teacher takes the core subjects for their own
  // section; specialists cover the rest across the school.
  var aseq = 0;
  sections.forEach(function (sec) {
    var subs = subjectsForClass_(sec.class_id);
    subs.forEach(function (subjectId, idx) {
      var staffId = idx < 3 ? classTeacherOf[sec.section_id]
                            : specialists[(idx + Number(sec.class_id)) % specialists.length];
      assignments.push({
        assignment_id: 'ASG-' + (++aseq),
        staff_id: staffId,
        class_id: sec.class_id,
        section: sec.section,
        subject_id: subjectId,
        year: APP.year
      });
    });
  });
  Repo.append(SS_KEY.CORE, 'Assignments', assignments);

  props_().setProperty('demo_principal', principalId);
  props_().setProperty('demo_admin', adminId);
  props_().setProperty('demo_accountant', accountantId);
  props_().setProperty('demo_coord_primary', coordPrimaryId);
  props_().setProperty('demo_coord_senior', coordSeniorId);

  return staff.length + ' staff, ' + assignments.length + ' teaching assignments';
}

function subjectsForClass_(classId) {
  var n = Number(classId);
  if (n <= 5) return ['ENG', 'URD', 'MATH', 'ISL', 'SCI', 'SST'];
  if (n <= 8) return ['ENG', 'URD', 'MATH', 'ISL', 'SCI', 'SST', 'COMP'];
  return ['ENG', 'URD', 'MATH', 'ISL', 'PHY', 'CHEM', 'BIO', 'COMP'];
}

// ---------------------------------------------------------- stage 4: students

function seed_students_() {
  ['Students', 'Guardians', 'Enrollment'].forEach(function (n) { Repo.clearBody(SS_KEY.CORE, n); });

  var students = [], guardians = [], enrollment = [];
  var sections = Repo.readAll(SS_KEY.CORE, 'Sections');
  var n = 0;

  sections.forEach(function (sec) {
    for (var roll = 1; roll <= DEMO.studentsPerSection; roll++) {
      n++;
      var male = rnd_() < 0.53;
      var first = rndPick_(male ? MALE_NAMES : FEMALE_NAMES);
      var family = rndPick_(FAMILY_NAMES);
      var fatherFirst = rndPick_(MALE_NAMES);
      var fatherName = fatherFirst + ' ' + family;
      var sid = studentId_(n);
      var age = 5 + Number(sec.class_id);
      var area = rndPick_(AREAS);

      students.push({
        student_id: sid,
        gr_no: 'GR-' + pad_(4000 + n, 5),
        adm_no: 'ADM-' + APP.year.slice(0, 4) + '-' + pad_(n, 4),
        name_en: first + ' ' + family,
        name_ur: '',
        father_name: fatherName,
        b_form_no: '42101-' + pad_(rndInt_(1000000, 9999999), 7) + '-' + rndInt_(1, 9),
        dob: (2026 - age) + '-' + pad_(rndInt_(1, 12), 2) + '-' + pad_(rndInt_(1, 28), 2),
        gender: male ? 'M' : 'F',
        religion: rnd_() < 0.97 ? 'Islam' : 'Christianity',
        admission_date: (2026 - Number(sec.class_id) + 1) + '-04-' + pad_(rndInt_(1, 20), 2),
        status: 'active',
        address: 'House ' + rndInt_(1, 900) + ', Block ' + rndInt_(1, 20) + ', ' + area,
        area: area,
        transport_route: rnd_() < 0.35 ? 'Route ' + rndInt_(1, 6) : '',
        house: DEMO.houses[n % DEMO.houses.length],
        photo_file_id: '',
        previous_school: rnd_() < 0.25 ? rndPick_(['City Grammar School', 'Falcon Public School',
                          'Iqra Model School', 'Bright Future Academy']) : '',
        medical_notes: rnd_() < 0.06 ? rndPick_(['Asthma — inhaler in bag',
                          'Spectacles', 'Peanut allergy']) : ''
      });

      guardians.push({
        guardian_id: guardianId_(n),
        student_id: sid,
        relation: 'Father',
        name: fatherName,
        cnic: '42101-' + pad_(rndInt_(1000000, 9999999), 7) + '-' + rndInt_(1, 9),
        phone_primary: '03' + pad_(rndInt_(0, 4), 1) + pad_(10000000 + n * 379, 8).slice(0, 8),
        phone_alt: '',
        whatsapp_ok: rnd_() < 0.9 ? 'yes' : 'no',
        occupation: rndPick_(OCCUPATIONS),
        email: '',
        is_fee_payer: 'yes'
      });

      enrollment.push({
        enrollment_id: 'ENR-' + APP.year.slice(0, 4) + '-' + pad_(n, 4),
        student_id: sid,
        year: APP.year,
        class_id: sec.class_id,
        section: sec.section,
        roll_no: roll,
        result: '',
        final_percentage: ''
      });
    }
  });

  Repo.append(SS_KEY.CORE, 'Students', students);
  Repo.append(SS_KEY.CORE, 'Guardians', guardians);
  Repo.append(SS_KEY.CORE, 'Enrollment', enrollment);

  return students.length + ' students with guardians and enrolment';
}

// ------------------------------------------------------------- stage 5: users

function seed_users_() {
  Repo.clearBody(SS_KEY.CORE, 'Users');

  var users = [];
  var seq = 0;
  var p = props_();

  // Every demo account shares one PIN, so the hash is computed ONCE and reused
  // rather than 640 times. Hashing is deliberately expensive (800 rounds), and
  // per-user hashing here is what blew the 6-minute execution limit.
  //
  // This is a demo-data shortcut only. Accounts created through the app get
  // their own salt via Auth.createUser(), which is unchanged — production
  // security is not what is being traded away here.
  var demoSalt = newSalt_();
  var demoHash = hashPin_(DEMO.pin, demoSalt);

  function add(loginId, name, role, scopeType, scopeIds, personId, personType) {
    users.push({
      user_id: userId_(++seq),
      person_id: personId,
      person_type: personType || 'staff',
      login_id: loginId,
      display_name: name,
      pin_hash: demoHash,
      salt: demoSalt,
      role: role,
      scope_type: scopeType,
      scope_ids: scopeIds || '',
      status: 'active',
      last_login: '',
      failed_count: 0
    });
  }

  var staff = Repo.indexBy(Repo.readAll(SS_KEY.CORE, 'Staff'), 'staff_id');
  var principalId = p.getProperty('demo_principal');
  var adminId = p.getProperty('demo_admin');
  var accountantId = p.getProperty('demo_accountant');
  var coordP = p.getProperty('demo_coord_primary');
  var coordS = p.getProperty('demo_coord_senior');

  add('principal', staff[principalId].name, ROLE.PRINCIPAL, 'school', '', principalId);
  add('office', staff[adminId].name, ROLE.ADMIN, 'school', '', adminId);
  add('accounts', staff[accountantId].name, ROLE.ACCOUNTANT, 'school', '', accountantId);
  add('coord.primary', staff[coordP].name, ROLE.COORDINATOR, 'wing', 'Primary', coordP);
  add('coord.senior', staff[coordS].name, ROLE.COORDINATOR, 'wing', 'Middle,Secondary', coordS);

  // Class teachers: scoped to their own section.
  var sections = Repo.readAll(SS_KEY.CORE, 'Sections');
  var tseq = 0;
  sections.forEach(function (sec) {
    var st = staff[sec.class_teacher_id];
    if (!st) return;
    tseq++;
    add('teacher' + pad_(tseq, 2), st.name, ROLE.CLASS_TEACHER, 'section',
        sec.class_id + '-' + sec.section, sec.class_teacher_id);
  });

  // Subject specialists: scoped to the exact (section, subject) pairs they teach.
  var assignments = Repo.readAll(SS_KEY.CORE, 'Assignments');
  var bySpecialist = {};
  var classTeacherIds = {};
  sections.forEach(function (s) { classTeacherIds[s.class_teacher_id] = true; });
  assignments.forEach(function (a) {
    if (classTeacherIds[a.staff_id]) return;
    var key = a.class_id + '-' + a.section + ':' + a.subject_id;
    (bySpecialist[a.staff_id] = bySpecialist[a.staff_id] || []).push(key);
  });
  var sseq = 0;
  Object.keys(bySpecialist).forEach(function (staffId) {
    sseq++;
    add('subject' + pad_(sseq, 2), staff[staffId].name, ROLE.TEACHER, 'subject_pairs',
        bySpecialist[staffId].join(','), staffId);
  });

  // Parents log in with the phone number already in the admission register.
  var guardians = Repo.readAll(SS_KEY.CORE, 'Guardians');
  guardians.forEach(function (g) {
    add(String(g.phone_primary), g.name, ROLE.PARENT, 'children', String(g.student_id),
        g.guardian_id, 'guardian');
  });

  // Chunked: hashing every PIN is the slow part of the whole seed.
  for (var i = 0; i < users.length; i += 400) {
    Repo.append(SS_KEY.CORE, 'Users', users.slice(i, i + 400));
  }

  p.setProperty('demo_parent_login', String(guardians[0].phone_primary));
  return users.length + ' user accounts (PIN ' + DEMO.pin + ')';
}

// -------------------------------------------------------- stage 6: attendance

function seed_attendance_() {
  var enrollment = Repo.readAll(SS_KEY.CORE, 'Enrollment');
  var written = 0;

  DEMO.attendanceMonths.forEach(function (yyyymm) {
    var headers = attendanceHeaders_(yyyymm);
    var days = daysInMonth_(yyyymm);
    var parts = yyyymm.split('-');
    var rows = [];

    enrollment.forEach(function (e) {
      // A few students are habitually irregular — the chronic-absentee list
      // needs somebody on it to be worth showing.
      var baseAttendance = rnd_() < 0.06 ? 0.72 : (rnd_() < 0.2 ? 0.88 : 0.96);
      var row = [e.student_id, e.class_id, e.section, e.roll_no];
      var present = 0, absent = 0, leave = 0;

      for (var d = 1; d <= days; d++) {
        var date = new Date(Number(parts[0]), Number(parts[1]) - 1, d);
        if (isWeekend_(date)) { row.push('H'); continue; }
        var r = rnd_();
        if (r < baseAttendance) { row.push('P'); present++; }
        else if (r < baseAttendance + 0.03) { row.push('L'); leave++; }
        else { row.push('A'); absent++; }
      }

      var total = present + absent + leave;
      row.push(present, absent, leave, total ? round2_(present * 100 / total) : 0);
      rows.push(row);
    });

    Repo.replaceAll(SS_KEY.ACAD, attendanceSheetName_(yyyymm), headers, rows);
    written += rows.length;
  });

  return written + ' attendance rows across ' + DEMO.attendanceMonths.length + ' months';
}

// ------------------------------------------------------------- stage 7: exams

function seed_exams_() {
  ['ExamDefs', 'ExamSubjects', 'Marks'].forEach(function (n) { Repo.clearBody(SS_KEY.ACAD, n); });

  Repo.append(SS_KEY.ACAD, 'ExamDefs', [
    { exam_id: 'EX-T1', exam_name: 'First Term Examination', year: APP.year, term: 'Term 1',
      starts_on: '2026-07-20', ends_on: '2026-07-31', status: 'completed', published: 'yes' },
    { exam_id: 'EX-MID', exam_name: 'Mid Term Assessment', year: APP.year, term: 'Term 2',
      starts_on: '2026-09-14', ends_on: '2026-09-22', status: 'in_progress', published: 'no' }
  ]);

  var examSubjects = [], eseq = 0;
  ['EX-T1', 'EX-MID'].forEach(function (examId) {
    for (var c = 1; c <= 10; c++) {
      subjectsForClass_(String(c)).forEach(function (subjectId) {
        var max = examId === 'EX-T1' ? 100 : 50;
        examSubjects.push({
          exam_subject_id: 'ES-' + (++eseq),
          exam_id: examId,
          class_id: String(c),
          subject_id: subjectId,
          max_marks: max,
          passing_marks: Math.round(max * 0.33),
          weightage: examId === 'EX-T1' ? 100 : 50
        });
      });
    }
  });
  Repo.append(SS_KEY.ACAD, 'ExamSubjects', examSubjects);

  var enrollment = Repo.readAll(SS_KEY.CORE, 'Enrollment');
  var marks = [], mseq = 0;

  // First Term: complete and locked — this is the published result set.
  enrollment.forEach(function (e) {
    // Each student has a stable ability, so results look like a real cohort
    // rather than noise.
    var ability = 0.35 + rnd_() * 0.55;
    subjectsForClass_(String(e.class_id)).forEach(function (subjectId) {
      var variance = (rnd_() - 0.5) * 0.22;
      var score = Math.max(0.05, Math.min(0.99, ability + variance));
      var absent = rnd_() < 0.012;
      marks.push({
        mark_id: 'MK-' + (++mseq),
        exam_id: 'EX-T1',
        student_id: e.student_id,
        class_id: e.class_id,
        section: e.section,
        subject_id: subjectId,
        marks_obtained: absent ? 0 : Math.round(score * 100),
        is_absent: absent ? 'yes' : 'no',
        entered_by: 'USR-0001',
        entered_at: '2026-08-03 11:20:00',
        locked: 'yes'
      });
    });
  });

  // Mid Term: deliberately half-entered, so the entry and verification
  // workflow has something real to demonstrate.
  enrollment.forEach(function (e) {
    if (Number(e.class_id) > 5) return; // only primary entered so far
    var ability = 0.4 + rnd_() * 0.5;
    subjectsForClass_(String(e.class_id)).slice(0, 3).forEach(function (subjectId) {
      marks.push({
        mark_id: 'MK-' + (++mseq),
        exam_id: 'EX-MID',
        student_id: e.student_id,
        class_id: e.class_id,
        section: e.section,
        subject_id: subjectId,
        marks_obtained: Math.round(Math.max(0.05, Math.min(0.99, ability + (rnd_() - 0.5) * 0.2)) * 50),
        is_absent: 'no',
        entered_by: 'USR-0006',
        entered_at: '2026-09-23 09:40:00',
        locked: 'no'
      });
    });
  });

  for (var i = 0; i < marks.length; i += 2000) {
    Repo.append(SS_KEY.ACAD, 'Marks', marks.slice(i, i + 2000));
  }

  return marks.length + ' mark rows across 2 exams';
}

// -------------------------------------------------------------- stage 8: fees

function seed_fees_() {
  ['Concessions', 'Invoices', 'Payments'].forEach(function (n) { Repo.clearBody(SS_KEY.FEES, n); });

  var enrollment = Repo.readAll(SS_KEY.CORE, 'Enrollment');
  var structure = Repo.readAll(SS_KEY.FEES, 'FeeStructure');
  var tuitionByClass = {};
  structure.forEach(function (s) {
    if (s.head_id === 'TUITION') tuitionByClass[String(s.class_id)] = Number(s.amount);
  });

  // A realistic spread of concessions: siblings, staff children, hardship.
  var concessions = [], cseq = 0;
  var concessionPercent = {};
  enrollment.forEach(function (e) {
    var r = rnd_();
    var pct = r < 0.06 ? 50 : (r < 0.16 ? 25 : (r < 0.22 ? 10 : 0));
    if (!pct) return;
    concessionPercent[e.student_id] = pct;
    concessions.push({
      concession_id: 'CON-' + (++cseq),
      student_id: e.student_id,
      type: pct === 50 ? 'Staff child' : (pct === 25 ? 'Sibling discount' : 'Hardship'),
      percent: pct,
      approved_by: 'USR-0001',
      valid_from: '2026-04-01',
      valid_to: '2027-03-31',
      note: ''
    });
  });
  Repo.append(SS_KEY.FEES, 'Concessions', concessions);

  var invoices = [], payments = [];
  var iseq = 0, pseq = 0, rseq = 0;

  enrollment.forEach(function (e) {
    var tuition = tuitionByClass[String(e.class_id)] || 2000;
    var pct = concessionPercent[e.student_id] || 0;
    // How reliably this family pays, held steady across the year.
    var reliability = rnd_();

    DEMO.feeMonths.forEach(function (month, mi) {
      var gross = tuition;
      if (month === '2026-04') gross += 6000;              // annual charges in April
      if (month === '2026-07') gross += 500;               // term exam fee
      var concession = Math.round(gross * pct / 100);
      var net = gross - concession;

      var invId = 'INV-' + month.replace('-', '') + '-' + pad_(++iseq, 5);
      var isRecent = mi >= DEMO.feeMonths.length - 1;      // September still open

      // Older months are mostly settled; the current month largely is not.
      var paysFully = reliability < (isRecent ? 0.35 : 0.86);
      var paysPartly = !paysFully && rnd_() < 0.25;
      var lateFine = (!paysFully && !isRecent && rnd_() < 0.4) ? 100 : 0;
      net += lateFine;

      invoices.push({
        invoice_id: invId,
        student_id: e.student_id,
        year: APP.year,
        month: month,
        issue_date: month + '-01',
        due_date: month + '-10',
        gross_amount: gross,
        concession_amount: concession,
        late_fine: lateFine,
        net_amount: net,
        status: paysFully ? 'paid' : (paysPartly ? 'partial' : 'unpaid')
      });

      if (paysFully || paysPartly) {
        var amount = paysFully ? net : Math.round(net * 0.5 / 100) * 100;
        payments.push({
          payment_id: 'PAY-' + (++pseq),
          invoice_id: invId,
          student_id: e.student_id,
          date: month + '-' + pad_(rndInt_(3, 20), 2),
          amount: amount,
          mode: rndPick_(['cash', 'cash', 'cash', 'bank', 'jazzcash', 'easypaisa']),
          reference_no: '',
          received_by: 'USR-0003',
          receipt_no: 'RCPT-2026-' + pad_(++rseq, 6),
          reversal_of: '',
          note: ''
        });
      }
    });
  });

  for (var i = 0; i < invoices.length; i += 2000) {
    Repo.append(SS_KEY.FEES, 'Invoices', invoices.slice(i, i + 2000));
  }
  for (var j = 0; j < payments.length; j += 2000) {
    Repo.append(SS_KEY.FEES, 'Payments', payments.slice(j, j + 2000));
  }

  // Keep the live receipt counter ahead of the seeded numbers.
  props_().setProperty('seq_receipt', String(rseq));
  props_().setProperty('seq_payment', String(pseq));

  return invoices.length + ' invoices, ' + payments.length + ' payments, ' +
         concessions.length + ' concessions';
}

// -------------------------------------------------------- stage 9: discipline

function seed_discipline_() {
  ['Discipline', 'Notices'].forEach(function (n) { Repo.clearBody(SS_KEY.ACAD, n); });

  var enrollment = Repo.readAll(SS_KEY.CORE, 'Enrollment');
  var sections = Repo.indexBy(Repo.readAll(SS_KEY.CORE, 'Sections'), 'section_id');
  var cats = Discipline.categories();
  var entries = [], seq = 0;

  var dates = ['2026-07-14', '2026-07-22', '2026-08-04', '2026-08-11', '2026-08-19',
               '2026-08-26', '2026-08-28'];

  enrollment.forEach(function (e) {
    var count = rndInt_(0, 5);
    var troubled = rnd_() < 0.08;
    for (var i = 0; i < count; i++) {
      // Most entries are positive; a small group accumulates negatives, which
      // is what makes the coordinator watchlist meaningful.
      var cat = troubled
        ? rndPick_(cats.filter(function (c) { return c.points < 0; }))
        : rndPick_(rnd_() < 0.62
            ? cats.filter(function (c) { return c.points > 0; })
            : cats.filter(function (c) { return c.points < 0; }));
      var sec = sections[e.class_id + '-' + e.section] || {};
      entries.push({
        entry_id: 'DP-' + (++seq),
        ts: rndPick_(dates) + ' ' + pad_(rndInt_(8, 13), 2) + ':' + pad_(rndInt_(0, 59), 2) + ':00',
        student_id: e.student_id,
        awarded_by: sec.class_teacher_id || '',
        category: cat.id,
        points: cat.points,
        reason_text: cat.label,
        reversal_of: '',
        reviewed_by: ''
      });
    }
  });

  for (var i = 0; i < entries.length; i += 2000) {
    Repo.append(SS_KEY.ACAD, 'Discipline', entries.slice(i, i + 2000));
  }
  props_().setProperty('seq_discipline', String(seq));

  Repo.append(SS_KEY.ACAD, 'Notices', [
    { notice_id: 'N-1', ts: '2026-08-25 09:00:00', title: 'First Term result announced',
      body: 'First Term result cards are now available in the parent portal. Parent-teacher meeting on Saturday 5 September, 9:00 am to 12:00 pm.',
      audience: 'all', class_id: '', posted_by: 'USR-0001' },
    { notice_id: 'N-2', ts: '2026-08-28 14:30:00', title: 'Fee reminder — September',
      body: 'September fees are due by the 10th. A late fine of Rs 20 per day applies after the due date. Fees may be paid at the school office or by JazzCash.',
      audience: 'all', class_id: '', posted_by: 'USR-0003' },
    { notice_id: 'N-3', ts: '2026-08-30 10:15:00', title: 'Mid Term Assessment schedule',
      body: 'The Mid Term Assessment runs from 14 to 22 September. The datesheet has been shared with class teachers.',
      audience: 'all', class_id: '', posted_by: 'USR-0001' },
    { notice_id: 'N-4', ts: '2026-09-01 08:00:00', title: 'Independence Day assembly — thank you',
      body: 'Thank you to all students and parents who took part in the 14 August assembly. House points have been awarded.',
      audience: 'all', class_id: '', posted_by: 'USR-0002' }
  ]);

  return entries.length + ' discipline entries, 4 notices';
}

/** Prints the demo logins after seeding. */
function showDemoLogins() {
  var out = {
    principal: 'principal / ' + DEMO.pin,
    office: 'office / ' + DEMO.pin,
    accountant: 'accounts / ' + DEMO.pin,
    coordinatorPrimary: 'coord.primary / ' + DEMO.pin,
    coordinatorSenior: 'coord.senior / ' + DEMO.pin,
    classTeacher: 'teacher01 / ' + DEMO.pin,
    subjectTeacher: 'subject01 / ' + DEMO.pin,
    parent: props_().getProperty('demo_parent_login') + ' / ' + DEMO.pin
  };
  console.log(JSON.stringify(out, null, 2));
  return out;
}
