// Stock purchases: tokens / certificates you buy from suppliers.
const db = require('../db/database');
const { ApiError, tokensWithStats, round2 } = require('./tokenController');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in the computer's time zone

/** Units in stock for a product, optionally ignoring one purchase/sale (used when editing). */
function onHand(tokenId, { exceptPurchase = 0, exceptSale = 0 } = {}) {
  const p = db.get('SELECT COALESCE(SUM(quantity), 0) q FROM stock_purchases WHERE token_id = ? AND id <> ?', [tokenId, exceptPurchase]).q;
  const s = db.get('SELECT COALESCE(SUM(quantity), 0) q FROM sales WHERE token_id = ? AND id <> ?', [tokenId, exceptSale]).q;
  return p - s;
}

/** Weighted average buying cost of a product across all purchases. */
function averageCost(tokenId) {
  const r = db.get('SELECT SUM(quantity) q, SUM(quantity * unit_cost) v FROM stock_purchases WHERE token_id = ?', [tokenId]);
  if (r && r.q > 0) return round2(r.v / r.q);
  const t = db.get('SELECT purchase_price FROM tokens WHERE id = ?', [tokenId]);
  return t ? round2(t.purchase_price) : 0;
}

function validate(body) {
  const tokenId = Number(body.token_id);
  if (!db.get('SELECT id FROM tokens WHERE id = ?', [tokenId])) throw new ApiError(400, 'Choose a product');
  const quantity = parseInt(body.quantity, 10);
  if (!Number.isInteger(quantity) || quantity <= 0) throw new ApiError(400, 'Quantity must be at least 1');
  const unitCost = Number(body.unit_cost);
  if (!Number.isFinite(unitCost) || unitCost < 0) throw new ApiError(400, 'Buying price must be 0 or more');
  const date = body.purchase_date || today();
  if (!DATE_RE.test(date)) throw new ApiError(400, 'Purchase date must be YYYY-MM-DD');
  return {
    token_id: tokenId,
    supplier: String(body.supplier || '').trim(),
    quantity,
    unit_cost: round2(unitCost),
    purchase_date: date,
    invoice_no: String(body.invoice_no || '').trim(),
    notes: String(body.notes || '').trim()
  };
}

const SELECT = `
  SELECT p.*, t.name AS token_name, t.category, (p.quantity * p.unit_cost) AS total_cost
  FROM stock_purchases p JOIN tokens t ON t.id = p.token_id`;

exports.listPurchases = (req, res) => {
  const where = [], params = [];
  if (req.query.token_id) { where.push('p.token_id = ?'); params.push(Number(req.query.token_id)); }
  if (req.query.from) { where.push('p.purchase_date >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('p.purchase_date <= ?'); params.push(req.query.to); }
  if (req.query.q) {
    where.push('(t.name LIKE ? OR p.supplier LIKE ? OR p.invoice_no LIKE ?)');
    const q = `%${req.query.q}%`; params.push(q, q, q);
  }
  const rows = db.all(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY p.purchase_date DESC, p.id DESC`, params);
  res.json(rows.map((r) => ({ ...r, total_cost: round2(r.total_cost) })));
};

exports.createPurchase = (req, res) => {
  const d = validate(req.body);
  const { id } = db.run(
    `INSERT INTO stock_purchases (token_id, supplier, quantity, unit_cost, purchase_date, invoice_no, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [d.token_id, d.supplier, d.quantity, d.unit_cost, d.purchase_date, d.invoice_no, d.notes]
  );
  res.status(201).json(db.get(`${SELECT} WHERE p.id = ?`, [id]));
};

exports.updatePurchase = (req, res) => {
  const id = Number(req.params.id);
  const old = db.get('SELECT * FROM stock_purchases WHERE id = ?', [id]);
  if (!old) throw new ApiError(404, 'Purchase not found');
  const d = validate({ ...old, ...req.body });

  // Reducing or moving a purchase must not leave already-sold units unaccounted for.
  const remainingOld = onHand(old.token_id, { exceptPurchase: id }) + (d.token_id === old.token_id ? d.quantity : 0);
  if (remainingOld < 0) {
    throw new ApiError(400, `Can't reduce this purchase: ${-remainingOld} unit(s) of it are already sold.`);
  }
  db.run(
    `UPDATE stock_purchases SET token_id = ?, supplier = ?, quantity = ?, unit_cost = ?, purchase_date = ?, invoice_no = ?, notes = ?
     WHERE id = ?`,
    [d.token_id, d.supplier, d.quantity, d.unit_cost, d.purchase_date, d.invoice_no, d.notes, id]
  );
  res.json(db.get(`${SELECT} WHERE p.id = ?`, [id]));
};

exports.deletePurchase = (req, res) => {
  const id = Number(req.params.id);
  const old = db.get('SELECT * FROM stock_purchases WHERE id = ?', [id]);
  if (!old) throw new ApiError(404, 'Purchase not found');
  const after = onHand(old.token_id, { exceptPurchase: id });
  if (after < 0) {
    throw new ApiError(400, `Can't delete: ${-after} unit(s) from this purchase are already sold. Delete those sales first.`);
  }
  db.run('DELETE FROM stock_purchases WHERE id = ?', [id]);
  res.json({ deleted: true });
};

/** Current stock of every product + totals. */
exports.summary = (req, res) => {
  const items = tokensWithStats().filter((t) => t.active || t.on_hand !== 0);
  const totals = items.reduce((acc, t) => {
    acc.units += Math.max(t.on_hand, 0);
    acc.stock_value += t.stock_value;
    acc.purchased_value += t.purchased_value;
    return acc;
  }, { units: 0, stock_value: 0, purchased_value: 0 });
  totals.stock_value = round2(totals.stock_value);
  totals.purchased_value = round2(totals.purchased_value);
  res.json({ totals, items, low_stock: items.filter((t) => t.low_stock) });
};

exports.onHand = onHand;
exports.averageCost = averageCost;
exports.today = today;
exports.DATE_RE = DATE_RE;
