'use strict';

/* ================================================================
   AccountingService — دفتر الحسابات + تقارير مالية + لوحة مالية.
   جميع السجلات تُولَّد تلقائياً من الأداءات/المرتجعات (لا إدخال يدوي).
   ================================================================ */

const { get, all, run } = require('../db/database').helpers;
const audit = require('./audit');

/* ---------- تسجيل في الدفتر ---------- */
function record({ entityType, entityId, type, amount, currency, description, referenceNumber, procedureId }) {
  const { getCurrentUser } = require('./auth');
  const user = getCurrentUser();
  const res = run(
    `INSERT INTO accounting_records (entity_type, entity_id, type, amount, currency, description, reference_number, procedure_id, recorded_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [entityType, entityId || 0, type, amount || 0, currency || 'MAD',
     description || '', referenceNumber || '', procedureId || 0, user.username]
  );
  return res.lastId;
}

/* ---------- استعلام من الدفتر ---------- */
function listRecords({ procedureId, type, entityType, page = 1, pageSize = 50 } = {}) {
  const where = [];
  const params = [];
  if (procedureId) where.push('ar.procedure_id = ?'), params.push(Number(procedureId));
  if (type) where.push('ar.type = ?'), params.push(type);
  if (entityType) where.push('ar.entity_type = ?'), params.push(entityType);
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = get(`SELECT COUNT(*) AS c FROM accounting_records ar ${whereSql}`, params).c;
  const pageNum = Math.max(1, Number(page) || 1);
  const size = Math.min(100, Number(pageSize) || 25);
  const offset = (pageNum - 1) * size;
  const rows = all(
    `SELECT ar.*, p.procedure_number
     FROM accounting_records ar
     LEFT JOIN procedures p ON p.id = ar.procedure_id
     ${whereSql}
     ORDER BY ar.id DESC LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  return { rows, total, page: pageNum, pageSize: size };
}

function getRecord(id) {
  return get('SELECT * FROM accounting_records WHERE id = ?', [id]);
}

/* ---------- ملخص مالي ---------- */
function financialSummary({ from, to } = {}) {
  const where = [];
  const params = [];
  if (from) where.push("date(recorded_at) >= date(?)"), params.push(from);
  if (to) where.push("date(recorded_at) <= date(?)"), params.push(to);

  const income = get(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM accounting_records ${where.length ? 'WHERE ' + where.join(' AND ') + ' AND' : 'WHERE'} type = 'income'`,
    params
  ).total;
  const expense = get(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM accounting_records ${where.length ? 'WHERE ' + where.join(' AND ') + ' AND' : 'WHERE'} type = 'expense'`,
    params
  ).total;
  const refund = get(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM accounting_records ${where.length ? 'WHERE ' + where.join(' AND ') + ' AND' : 'WHERE'} type = 'refund'`,
    params
  ).total;

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const byType = {};
  all(
    `SELECT type, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
     FROM accounting_records ${whereSql} GROUP BY type`,
    params
  ).forEach((r) => {
    byType[r.type] = { amount: Number(r.total), count: Number(r.cnt) };
  });

  return { income, expense, refund, net: income - expense - refund, byType };
}

/* ---------- إحصائيات لوحة التحكم المالية ---------- */
function dashboard() {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const totalPayments = get('SELECT COUNT(*) AS c FROM payments').c;
  const pendingPayments = get("SELECT COUNT(*) AS c FROM payments WHERE status = 'PENDING'").c;
  const confirmedPayments = get("SELECT COUNT(*) AS c FROM payments WHERE status = 'CONFIRMED'").c;

  const todayTotal = get(
    "SELECT COALESCE(SUM(amount), 0) AS t FROM payments WHERE status IN ('CONFIRMED','PAID') AND date(payment_date) = ?",
    [today]
  ).t;
  const weekTotal = get(
    "SELECT COALESCE(SUM(amount), 0) AS t FROM payments WHERE status IN ('CONFIRMED','PAID') AND date(payment_date) >= ?",
    [weekAgo]
  ).t;
  const monthTotal = get(
    "SELECT COALESCE(SUM(amount), 0) AS t FROM payments WHERE status IN ('CONFIRMED','PAID') AND date(payment_date) >= ?",
    [monthAgo]
  ).t;

  const totalRefunded = get("SELECT COALESCE(SUM(amount), 0) AS t FROM payments WHERE status = 'REFUNDED'").t;

  const assessmentsDraft = get("SELECT COUNT(*) AS c FROM fee_assessments WHERE status = 'DRAFT'").c;
  const assessmentsConfirmed = get("SELECT COUNT(*) AS c FROM fee_assessments WHERE status IN ('CONFIRMED','PARTIALLY_PAID')").c;

  return {
    totalPayments, pendingPayments, confirmedPayments,
    todayTotal, weekTotal, monthTotal,
    totalRefunded, assessmentsDraft, assessmentsConfirmed
  };
}

/* ---------- تقرير حسب الإجراء ---------- */
function procedureReport(procedureId) {
  const payments = all(
    "SELECT * FROM payments WHERE procedure_id = ? ORDER BY payment_date",
    [procedureId]
  );
  const totalPaid = get(
    "SELECT COALESCE(SUM(amount), 0) AS t FROM payments WHERE procedure_id = ? AND status IN ('CONFIRMED','PAID')",
    [procedureId]
  ).t;
  const totalRefunded = get(
    "SELECT COALESCE(SUM(amount), 0) AS t FROM payments WHERE procedure_id = ? AND status = 'REFUNDED'",
    [procedureId]
  ).t;
  const assessments = all(
    'SELECT * FROM fee_assessments WHERE procedure_id = ? ORDER BY id',
    [procedureId]
  );
  return { payments, totalPaid, totalRefunded, assessments };
}

module.exports = { record, listRecords, getRecord, financialSummary, dashboard, procedureReport };
