# School OS

A school management system whose entire backend is Google Drive, Sheets and Docs, and
whose front end is an Apps Script web app. Built to be deployed per school: the data
folder is copied, the code is pushed.

Target: private schools of 100–1,200 students in Karachi and comparable markets.

## Why this shape

Google hosts it, so there is no server to run and no hosting cost per school. The
spreadsheet backend is also the product's escape hatch — when the software does not
cover an edge case, the office clerk opens the sheet and fixes the row.

The architecture brief covering tenancy, identity, the data model and the module map
lives in [`docs/architecture.html`](docs/architecture.html).

## Layout

```
apps-script/           the Apps Script project (clasp root)
  00_bootstrap.gs      constants, config, spreadsheet handles
  01_util.gs           ids, dates, hashing, cache, locking
  02_schema.gs         every sheet's columns — the single source of truth
  03_repo.gs           THE ONLY FILE THAT TOUCHES SpreadsheetApp for data
  04_auth.gs           phone/PIN login, signed session tokens
  05_guard.gs          the permission + scope gate
  06_svc_school.gs     students, sections, dashboard
  07_svc_attendance.gs wide monthly attendance grid
  08_svc_exams.gs      marks entry, locking, result compilation
  09_svc_fees.gs       invoices, append-only payment ledger, defaulters
  10_svc_discipline.gs merit/demerit ledger with guardrails
  11_api.gs            every client-callable endpoint; each starts with guard()
  20_seed.gs           demo school generator
  ui_index.html        app shell
  ui_css.html          styles
  ui_js.html           client
docs/architecture.html   the design brief
```

## Two rules that keep this safe

1. **Every API endpoint calls `guard()` first.** The web app executes with the owner's
   full authority, so one endpoint without it exposes the whole school.
2. **Only `03_repo.gs` touches `SpreadsheetApp` for data.** If this outgrows Sheets,
   the repository layer is what gets swapped for a database; the business logic above
   it survives.

## Setup

Requires the Apps Script API to be enabled once per account at
<https://script.google.com/home/usersettings>.

```bash
npm install -g @google/clasp
clasp login
cd apps-script
clasp create --type standalone --title "School OS"
clasp push
```

Then, in the Apps Script editor, run `setupAndSeedDemoSchool()` once. It creates the
Drive folder tree, three spreadsheets, and a complete demo school: 600 students across
Classes 1–10, staff, guardians, four months of attendance, two exams with marks, six
months of fee invoices and payments, and a discipline ledger.

Deploy as a web app (execute as **me**, access **anyone**) and open the URL.

Run `showDemoLogins()` to print the demo accounts. Every demo PIN is `1234`.

| Role | Login |
|---|---|
| Principal | `principal` |
| Office | `office` |
| Accountant | `accounts` |
| Coordinator | `coord.primary`, `coord.senior` |
| Class teacher | `teacher01` … `teacher20` |
| Subject teacher | `subject01` … |
| Parent | a guardian's phone number (see `showDemoLogins()`) |

## Status

Early. The modules above work end to end against the demo data. Report card PDF
generation, timetable, the bulk importer and year rollover are designed but not yet
built — see the architecture brief.
