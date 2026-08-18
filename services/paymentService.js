'use strict';

/* ================================================================
   PaymentService — الأداءات + تأكيد/إلغاء/استرداد + معاملات + وصولات.
   لا أتعاب مخزنة: المبالغ تأتي من المستخدم أو من fee_assessments.
   ================================================================ */

const { get, all, run, tx, nextSequence } = require('../db/database').helpers;
const audit = require('./audit');
const accounting = require('./accountingService');
const registersService = require('./registersService');
const { getCurrentUser, requireAuth } = require('./auth');

/* ---------- طرق الدفع ---------- */
function listPaymentMethods() {
  return all('SELECT * FROM payment_methods WHERE active = 1 ORDER BY sort_order, id');
}

function getPaymentMethod(id) {
  return get('SELECT * FROM payment_methods WHERE id = ?', [id]);
}

function addPaymentMethod(input) {
  requireAuth('tariff.manage');
  const res = run(
    'INSERT INTO payment_methods (code, name_ar, name_fr, active, sort_order) VALUES (?,?,?,?,?)',
    [input.code, input.nameAr, input.nameFr, 1,
     input.sortOrder || (get('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM payment_methods').n)]
  );
  return { id: res.lastId, ...input };
}

function updatePaymentMethod(id, input) {
  requireAuth('tariff.manage');
  const sets = [];
  const params = [];
  if (input.nameAr !== undefined) sets.push('name_ar = ?'), params.push(input.nameAr);
  if (input.nameFr !== undefined) sets.push('name_fr = ?'), params.push(input.nameFr);
  if (input.active !== undefined) sets.push('active = ?'), params.push(input.active ? 1 : 0);
  if (input.sortOrder !== undefined) sets.push('sort_order = ?'), params.push(input.sortOrder);
  if (!sets.length) return getPaymentMethod(id);
  params.push(id);
  run(`UPDATE payment_methods SET ${sets.join(', ')} WHERE id = ?`, params);
  return getPaymentMethod(id);
}

/* ---------- إضافة أداء ---------- */
function addPayment(procedureId, input) {
  const proc = get('SELECT id FROM procedures WHERE id = ?', [procedureId]);
  if (!proc) throw new Error('NOT_FOUND:procedure:' + procedureId);

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('VALIDATION:payment:amount');

  const method = input.method || '';
  const paymentMethodId = Number(input.paymentMethodId) || 0;
  const assessmentId = Number(input.assessmentId) || 0;
  const status = 'PENDING';

  return tx(() => {
    const user = getCurrentUser();
    const res = run(
      `INSERT INTO payments (procedure_id, amount, method, payment_date, status, reference, notes,
        assessment_id, payment_method_id, confirmed_by, overpay_amount, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,0,datetime('now'))`,
      [procedureId, amount, method, input.payment_date || new Date().toISOString().slice(0, 10),
       status, input.reference || '', input.notes || '',
       assessmentId, paymentMethodId, '']
    );
    const paymentId = res.lastId;

    run(
      `INSERT INTO payment_transactions (payment_id, amount, type, transaction_date, reference, notes, created_by)
       VALUES (?,?, 'initial', ?, ?, ?, ?)`,
      [paymentId, amount, input.payment_date || new Date().toISOString().slice(0, 10),
       input.reference || '', 'دفعة أولى', user.username]
    );

    audit.log({
      action: 'payment.created', entity: 'procedure', entityId: procedureId,
      metadata: { payment_id: paymentId, amount, method, assessment_id: assessmentId }
    });

    return getPayment(paymentId);
  });
}

function getPayment(id) {
  return get('SELECT * FROM payments WHERE id = ?', [id]);
}

function getPaymentDetail(id) {
  const p = getPayment(id);
  if (!p) throw new Error('NOT_FOUND:payment:' + id);
  p.transactions = all(
    'SELECT * FROM payment_transactions WHERE payment_id = ? ORDER BY id',
    [id]
  );
  p.procedure = get('SELECT procedure_number, currency FROM procedures WHERE id = ?', [p.procedure_id]);
  p.method_info = p.payment_method_id ? getPaymentMethod(p.payment_method_id) : null;
  return p;
}

function listPayments({ procedureId, status, method, page = 1, pageSize = 25 } = {}) {
  const where = [];
  const params = [];
  if (procedureId) where.push('pay.procedure_id = ?'), params.push(Number(procedureId));
  if (status) where.push('pay.status = ?'), params.push(status);
  if (method) where.push('pay.method = ?'), params.push(method);
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = get(`SELECT COUNT(*) AS c FROM payments pay ${whereSql}`, params).c;
  const pageNum = Math.max(1, Number(page) || 1);
  const size = Math.min(100, Number(pageSize) || 25);
  const offset = (pageNum - 1) * size;
  const rows = all(
    `SELECT pay.*, p.procedure_number, pm.name_ar AS method_name_ar, pm.name_fr AS method_name_fr
     FROM payments pay
     LEFT JOIN procedures p ON p.id = pay.procedure_id
     LEFT JOIN payment_methods pm ON pm.id = pay.payment_method_id
     ${whereSql}
     ORDER BY pay.id DESC LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  return { rows, total, page: pageNum, pageSize: size };
}

/* ---------- تأكيد أداء ---------- */
function confirmPayment(id) {
  requireAuth('payment.confirm');
  const p = getPayment(id);
  if (!p) throw new Error('NOT_FOUND:payment:' + id);
  if (p.status !== 'PENDING') throw new Error('VALIDATION:payment:notPending');

  const user = getCurrentUser();
  return tx(() => {
    run(
      "UPDATE payments SET status = 'CONFIRMED', confirmed_at = datetime('now'), confirmed_by = ? WHERE id = ?",
      [user.username, id]
    );
    run(
      `INSERT INTO payment_transactions (payment_id, amount, type, transaction_date, notes, created_by)
       VALUES (?, ?, 'confirmation', datetime('now'), ?, ?)`,
      [id, p.amount, 'تأكيد الأداء', user.username]
    );

    updateAssessmentStatus(p.assessment_id);

    accounting.record({
      entityType: 'payment', entityId: id, type: 'income',
      amount: p.amount, currency: p.currency || 'MAD',
      description: 'تأكيد أداء رقم ' + id,
      referenceNumber: p.reference || '', procedureId: p.procedure_id
    });

    // السجل المهني للعمليات الحسابية: ربط تلقائي (قابل للإلغاء من الإعدادات)
    registersService.autoCreateAccountingForPayment(id, {
      flowType: 'income', amount: p.amount, currency: p.currency, procedureId: p.procedure_id
    });

    audit.log({
      action: 'payment.confirmed', entity: 'procedure', entityId: p.procedure_id,
      metadata: { payment_id: id, amount: p.amount, by: user.username }
    });

    return getPaymentDetail(id);
  });
}

/* ---------- إلغاء أداء ---------- */
function cancelPayment(id, reason) {
  requireAuth('payment.cancel');
  const p = getPayment(id);
  if (!p) throw new Error('NOT_FOUND:payment:' + id);
  if (p.status === 'CANCELLED') throw new Error('VALIDATION:payment:alreadyCancelled');
  if (p.status === 'REFUNDED') throw new Error('VALIDATION:payment:alreadyRefunded');

  const user = getCurrentUser();
  return tx(() => {
    run(
      "UPDATE payments SET status = 'CANCELLED', notes = COALESCE(NULLIF(notes,'') || ' | ', '') || ? WHERE id = ?",
      [reason || 'إلغاء', id]
    );
    run(
      `INSERT INTO payment_transactions (payment_id, amount, type, transaction_date, notes, created_by)
       VALUES (?, ?, 'cancellation', datetime('now'), ?, ?)`,
      [id, 0 - p.amount, reason || 'إلغاء الأداء', user.username]
    );

    updateAssessmentStatus(p.assessment_id);

    audit.log({
      action: 'payment.cancelled', entity: 'procedure', entityId: p.procedure_id,
      metadata: { payment_id: id, amount: p.amount, reason }
    });

    return getPaymentDetail(id);
  });
}

/* ---------- استرداد (Refund) ---------- */
function refundPayment(id, input) {
  requireAuth('refund.create');
  const p = getPayment(id);
  if (!p) throw new Error('NOT_FOUND:payment:' + id);
  if (p.status !== 'CONFIRMED' && p.status !== 'PAID') {
    throw new Error('VALIDATION:payment:notRefundable');
  }

  const refundAmount = Number(input.amount);
  if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
    throw new Error('VALIDATION:refund:amount');
  }
  if (refundAmount > p.amount) throw new Error('VALIDATION:refund:exceedsPayment');

  const user = getCurrentUser();
  return tx(() => {
    const res = run(
      `INSERT INTO refunds (payment_id, amount, reason, status, refund_date, notes, created_by)
       VALUES (?, ?, ?, 'PENDING', datetime('now'), ?, ?)`,
      [id, refundAmount, input.reason || '', input.notes || '', user.username]
    );
    const refundId = res.lastId;

    const newStatus = refundAmount >= p.amount ? 'REFUNDED' : p.status;
    if (newStatus !== p.status) {
      run('UPDATE payments SET status = ? WHERE id = ?', [newStatus, id]);
    }

    run(
      `INSERT INTO payment_transactions (payment_id, amount, type, transaction_date, notes, created_by)
       VALUES (?, ?, 'refund', datetime('now'), ?, ?)`,
      [id, 0 - refundAmount, input.reason || 'استرداد', user.username]
    );

    updateAssessmentStatus(p.assessment_id);

    accounting.record({
      entityType: 'payment', entityId: id, type: 'refund',
      amount: refundAmount, currency: p.currency || 'MAD',
      description: 'استرداد من أداء رقم ' + id,
      referenceNumber: input.reason || '', procedureId: p.procedure_id
    });

    // السجل المهني: تسجيل الاسترداد كقيد موثق
    registersService.autoCreateAccountingForPayment(id, {
      flowType: 'refund', amount: refundAmount, currency: p.currency, procedureId: p.procedure_id
    });

    audit.log({
      action: 'payment.refunded', entity: 'procedure', entityId: p.procedure_id,
      metadata: { payment_id: id, refund_id: refundId, amount: refundAmount }
    });

    return { refundId, status: newStatus };
  });
}

function listRefunds(paymentId) {
  return all('SELECT * FROM refunds WHERE payment_id = ? ORDER BY id DESC', [paymentId]);
}

/* ---------- تحديث حالة التقييم بناءً على المدفوعات ---------- */
function updateAssessmentStatus(assessmentId) {
  if (!assessmentId) return;
  const a = get('SELECT * FROM fee_assessments WHERE id = ?', [assessmentId]);
  if (!a || a.status === 'CANCELLED') return;

  const paid = get(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE assessment_id = ? AND status IN ('CONFIRMED','PAID')",
    [assessmentId]
  ).total;
  const refunded = get(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE assessment_id = ? AND status = 'REFUNDED'",
    [assessmentId]
  ).total;
  const net = paid - refunded;

  let newStatus = a.status;
  if (net >= a.total_amount && a.total_amount > 0) {
    newStatus = 'PAID';
  } else if (net > 0) {
    newStatus = 'PARTIALLY_PAID';
  }

  if (newStatus !== a.status) {
    run("UPDATE fee_assessments SET status = ?, updated_at = datetime('now') WHERE id = ?", [newStatus, a.id]);
  }
}

/* ---------- رقم وصل فريد ---------- */
function generateReceiptNumber() {
  const year = new Date().getFullYear();
  const seq = nextSequence('receipt:' + year);
  return `REC-${year}-${String(seq).padStart(4, '0')}`;
}

/* ---------- إلغاء وصل ---------- */
function cancelReceipt(id, reason) {
  requireAuth('receipt.cancel');
  const r = get('SELECT * FROM receipts WHERE id = ?', [id]);
  if (!r) throw new Error('NOT_FOUND:receipt:' + id);
  if (r.status === 'CANCELLED') throw new Error('VALIDATION:receipt:alreadyCancelled');
  const user = getCurrentUser();
  run(
    "UPDATE receipts SET status = 'CANCELLED', cancelled_at = datetime('now'), cancelled_by = ?, cancellation_reason = ? WHERE id = ?",
    [user.username, reason || '', id]
  );
  audit.log({ action: 'receipt.cancelled', entity: 'receipt', entityId: id, metadata: { number: r.receipt_number, reason } });
  return get('SELECT * FROM receipts WHERE id = ?', [id]);
}

/* ---------- إحصائيات الأداءات ---------- */
function paymentStats() {
  const total = get('SELECT COUNT(*) AS c FROM payments').c;
  const byStatus = {};
  all('SELECT status, COUNT(*) AS c FROM payments GROUP BY status').forEach((r) => {
    byStatus[r.status] = Number(r.c);
  });
  const totalPaid = get("SELECT COALESCE(SUM(amount), 0) AS t FROM payments WHERE status IN ('CONFIRMED','PAID')").t;
  const totalRefunded = get("SELECT COALESCE(SUM(amount), 0) AS t FROM payments WHERE status = 'REFUNDED'").t;
  const totalPending = get("SELECT COALESCE(SUM(amount), 0) AS t FROM payments WHERE status = 'PENDING'").t;
  return { total, byStatus, totalPaid, totalRefunded, totalPending };
}

/* ---------- سجل تدقيق مالي ---------- */
function listFinancialAudit({ procedureId, entityType, page = 1, pageSize = 50 } = {}) {
  const where = [];
  const params = [];
  if (procedureId) where.push('entity = ? AND entity_id = ?'), params.push('procedure', Number(procedureId));
  if (entityType) where.push('entity = ?'), params.push(entityType);
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const base = `FROM audit_logs ${whereSql}`;
  const total = get(`SELECT COUNT(*) AS c ${base}`, params).c;
  const pageNum = Math.max(1, Number(page) || 1);
  const size = Math.min(100, Number(pageSize) || 25);
  const offset = (pageNum - 1) * size;
  const rows = all(
    `SELECT * ${base} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  return { rows, total, page: pageNum, pageSize: size };
}

module.exports = {
  listPaymentMethods, getPaymentMethod, addPaymentMethod, updatePaymentMethod,
  addPayment, getPayment, getPaymentDetail, listPayments,
  confirmPayment, cancelPayment, refundPayment, listRefunds,
  generateReceiptNumber, cancelReceipt,
  paymentStats, listFinancialAudit
};
