/**
 * School OS — fees
 *
 * The module that sells the product. A principal will tolerate clunky
 * attendance; they will not tolerate not knowing who owes what.
 *
 * Payments are an append-only ledger. Balances are never stored — they are
 * reduced from invoices minus payments, so two receipts in the same second
 * cannot corrupt each other and a mistake is corrected by appending a
 * reversal rather than editing history.
 */

var Fees = (function () {

  function heads() { return Repo.readCached(SS_KEY.FEES, 'FeeHeads'); }

  function structureFor(classId) {
    return Repo.readCached(SS_KEY.FEES, 'FeeStructure').filter(function (r) {
      return String(r.class_id) === String(classId) && String(r.year) === APP.year;
    });
  }

  function concessionFor(studentId) {
    var c = Repo.readCached(SS_KEY.FEES, 'Concessions').filter(function (r) {
      return String(r.student_id) === String(studentId);
    })[0];
    return c ? Number(c.percent || 0) : 0;
  }

  function invoices(filterFn) {
    var rows = Repo.readCached(SS_KEY.FEES, 'Invoices', 300);
    return filterFn ? rows.filter(filterFn) : rows;
  }

  function payments(filterFn) {
    var rows = Repo.readCached(SS_KEY.FEES, 'Payments', 300);
    return filterFn ? rows.filter(filterFn) : rows;
  }

  /** Net paid against one invoice, reversals cancelled out. */
  function paidByInvoice() {
    var out = {};
    payments().forEach(function (p) {
      if (String(p.reversal_of || '')) {
        out[p.invoice_id] = (out[p.invoice_id] || 0) - Number(p.amount || 0);
      } else {
        out[p.invoice_id] = (out[p.invoice_id] || 0) + Number(p.amount || 0);
      }
    });
    return out;
  }

  /** Full ledger for one student — the parent portal's fee card. */
  function studentLedger(studentId) {
    var paid = paidByInvoice();
    var inv = invoices(function (i) { return String(i.student_id) === String(studentId); })
      .sort(function (a, b) { return String(a.month).localeCompare(String(b.month)); });

    var rows = inv.map(function (i) {
      var p = paid[i.invoice_id] || 0;
      var net = Number(i.net_amount || 0);
      return {
        invoiceId: i.invoice_id,
        month: i.month,
        issueDate: i.issue_date,
        dueDate: i.due_date,
        gross: Number(i.gross_amount || 0),
        concession: Number(i.concession_amount || 0),
        lateFine: Number(i.late_fine || 0),
        net: net,
        paid: p,
        balance: round2_(net - p),
        status: p >= net ? 'Paid' : (p > 0 ? 'Partial' : 'Unpaid')
      };
    });

    var billed = sum_(rows.map(function (r) { return r.net; }));
    var collected = sum_(rows.map(function (r) { return r.paid; }));

    return {
      studentId: studentId,
      rows: rows,
      billed: billed,
      collected: collected,
      outstanding: round2_(billed - collected),
      receipts: payments(function (p) { return String(p.student_id) === String(studentId); })
        .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); })
    };
  }

  /** Records a payment. Append-only; receipt numbers never skip. */
  function recordPayment(session, opts) {
    if (!opts.invoiceId || !opts.amount) throw new Error('Invoice and amount are required.');
    var amount = Number(opts.amount);
    if (isNaN(amount) || amount <= 0) throw new Error('Amount must be more than zero.');

    return withLock_(function () {
      var inv = invoices(function (i) {
        return String(i.invoice_id) === String(opts.invoiceId);
      })[0];
      if (!inv) throw new Error('Invoice not found.');

      var already = paidByInvoice()[inv.invoice_id] || 0;
      var balance = Number(inv.net_amount || 0) - already;
      if (amount > balance + 0.01) {
        throw new Error('That is more than the outstanding balance of Rs ' + balance + '.');
      }

      var receiptNo = 'RCPT-' + APP.year.slice(0, 4) + '-' + pad_(nextSeq_('receipt'), 6);
      var payment = {
        payment_id: 'PAY-' + nextSeq_('payment'),
        invoice_id: inv.invoice_id,
        student_id: inv.student_id,
        date: opts.date || today_(),
        amount: amount,
        mode: opts.mode || 'cash',
        reference_no: opts.referenceNo || '',
        received_by: session.userId,
        receipt_no: receiptNo,
        reversal_of: '',
        note: opts.note || ''
      };
      Repo.append(SS_KEY.FEES, 'Payments', [payment]);

      var newPaid = already + amount;
      Repo.updateRow(SS_KEY.FEES, 'Invoices', inv._row, {
        status: newPaid >= Number(inv.net_amount) ? 'paid' : 'partial'
      });

      Repo.audit(session, 'fees.payment', 'invoice', inv.invoice_id, null,
                 { amount: amount, receipt: receiptNo });
      return { receiptNo: receiptNo, paid: newPaid, balance: round2_(Number(inv.net_amount) - newPaid) };
    });
  }

  /** Defaulter list — the single most-used screen in the product. */
  function defaulters(minAmount) {
    var paid = paidByInvoice();
    var students = Repo.indexBy(Repo.readCached(SS_KEY.CORE, 'Students'), 'student_id');
    var enr = {};
    Repo.readCached(SS_KEY.CORE, 'Enrollment').forEach(function (e) {
      if (String(e.year) === APP.year) enr[e.student_id] = e;
    });

    var byStudent = {};
    invoices().forEach(function (i) {
      var bal = Number(i.net_amount || 0) - (paid[i.invoice_id] || 0);
      if (bal <= 0.01) return;
      var s = byStudent[i.student_id] || { balance: 0, months: [] };
      s.balance += bal;
      s.months.push(i.month);
      byStudent[i.student_id] = s;
    });

    return Object.keys(byStudent).map(function (sid) {
      var s = students[sid] || {};
      var e = enr[sid] || {};
      var guardian = Repo.readCached(SS_KEY.CORE, 'Guardians').filter(function (g) {
        return String(g.student_id) === String(sid) && String(g.is_fee_payer) === 'yes';
      })[0] || {};
      return {
        studentId: sid,
        name: s.name_en || '',
        fatherName: s.father_name || '',
        sectionKey: e.class_id ? e.class_id + '-' + e.section : '',
        phone: guardian.phone_primary || '',
        balance: round2_(byStudent[sid].balance),
        monthsOverdue: byStudent[sid].months.length
      };
    })
    .filter(function (r) { return r.balance >= (minAmount || 1); })
    .sort(function (a, b) { return b.balance - a.balance; });
  }

  function collectionSummary() {
    var paid = paidByInvoice();
    var billed = 0, collected = 0, defaulterSet = {};
    invoices().forEach(function (i) {
      var net = Number(i.net_amount || 0);
      var p = paid[i.invoice_id] || 0;
      billed += net;
      collected += p;
      if (net - p > 0.01) defaulterSet[i.student_id] = true;
    });
    return {
      billed: Math.round(billed),
      collected: Math.round(collected),
      outstanding: Math.round(billed - collected),
      rate: billed ? round2_(collected * 100 / billed) : 0,
      defaulters: Object.keys(defaulterSet).length
    };
  }

  /** Daily reconciliation for the accountant's window. */
  function dayBook(dateStr) {
    var d = dateStr || today_();
    var rows = payments(function (p) { return String(p.date) === d; });
    var byMode = {};
    rows.forEach(function (p) {
      byMode[p.mode] = (byMode[p.mode] || 0) + Number(p.amount || 0);
    });
    return {
      date: d,
      count: rows.length,
      total: Math.round(sum_(rows.map(function (r) { return r.amount; }))),
      byMode: byMode,
      rows: rows.sort(function (a, b) {
        return String(b.receipt_no).localeCompare(String(a.receipt_no));
      })
    };
  }

  /** Outstanding invoices for one student, for the collection window. */
  function openInvoices(studentId) {
    var paid = paidByInvoice();
    return invoices(function (i) { return String(i.student_id) === String(studentId); })
      .map(function (i) {
        var p = paid[i.invoice_id] || 0;
        return {
          invoiceId: i.invoice_id,
          month: i.month,
          dueDate: i.due_date,
          net: Number(i.net_amount || 0),
          paid: p,
          balance: round2_(Number(i.net_amount || 0) - p)
        };
      })
      .filter(function (r) { return r.balance > 0.01; })
      .sort(function (a, b) { return String(a.month).localeCompare(String(b.month)); });
  }

  return {
    heads: heads,
    structureFor: structureFor,
    concessionFor: concessionFor,
    invoices: invoices,
    payments: payments,
    paidByInvoice: paidByInvoice,
    studentLedger: studentLedger,
    recordPayment: recordPayment,
    defaulters: defaulters,
    collectionSummary: collectionSummary,
    dayBook: dayBook,
    openInvoices: openInvoices
  };
})();
