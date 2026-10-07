// Sales of tokens / certificates, plus customers, dashboard and reports built from sales.
const db = require('../db/database');
const { ApiError, round2, tokensWithStats } = require('./tokenController');
const { onHand, averageCost, today, DATE_RE } = require('./stockController');

const PAYMENT_MODES = ['Cash', 'UPI', 'Bank', 'Card', 'Credit'];
const STATUSES = ['Paid', 'Pending'];

const SELECT = `
  SELECT s.*, t.name AS token_name, t.category,
         (s.quantity * s.unit_price) AS amount,
         (s.quantity * s.unit_cost)  AS cost,
         (s.quantity * (s.unit_price - s.unit_cost)) AS profit
  FROM sales s JOIN tokens t ON t.id = s.token_id`;

const shape = (r) => r && ({ ...r, amount: round2(r.amount), cost: round2(r.cost), profit: round2(r.profit) });

function validate(body) {
  const tokenId = Number(body.token_id);
  if (!db.get('SELECT id FROM tokens WHERE id = ?', [tokenId])) throw new ApiError(400, 'Choose a product');
  const name = String(body.customer_name || '').trim();
  if (!name) throw new ApiError(400, 'Customer name is required');
  const quantity = parseInt(body.quantity, 10);
  if (!Number.isInteger(quantity) || quantity <= 0) throw new ApiError(400, 'Quantity must be at least 1');
  const unitPrice = Number(body.unit_price);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new ApiError(400, 'Selling price must be 0 or more');
  const date = body.sale_date || today();
  if (!DATE_RE.test(date)) throw new ApiError(400, 'Sale date must be YYYY-MM-DD');
  return {
    token_id: tokenId,
    customer_name: name,
    customer_phone: String(body.customer_phone || '').trim(),
    customer_email: String(body.customer_email || '').trim(),
    company: String(body.company || '').trim(),
    quantity,
    unit_price: round2(unitPrice),
    sale_date: date,
    payment_mode: PAYMENT_MODES.includes(body.payment_mode) ? body.payment_mode : 'Cash',
    payment_status: STATUSES.includes(body.payment_status) ? body.payment_status : 'Paid',
    invoice_no: String(body.invoice_no || '').trim(),
    notes: String(body.notes || '').trim()
  };
}

function nextInvoiceNo() {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const r = db.get(`SELECT MAX(CAST(substr(invoice_no, ?) AS INTEGER)) n FROM sales WHERE invoice_no LIKE ?`, [prefix.length + 1, prefix + '%']);
  return prefix + String((r.n || 0) + 1).padStart(4, '0');
}

/* ---------------- CRUD ---------------- */

exports.list = (req, res) => {
  const where = [], params = [];
  const { from, to, token_id, status, q } = req.query;
  if (from) { where.push('s.sale_date >= ?'); params.push(from); }
  if (to) { where.push('s.sale_date <= ?'); params.push(to); }
  if (token_id) { where.push('s.token_id = ?'); params.push(Number(token_id)); }
  if (status) { where.push('s.payment_status = ?'); params.push(status); }
  if (q) {
    where.push('(s.customer_name LIKE ? OR s.customer_phone LIKE ? OR s.company LIKE ? OR s.invoice_no LIKE ? OR t.name LIKE ?)');
    const like = `%${q}%`; params.push(like, like, like, like, like);
  }
  const rows = db.all(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY s.sale_date DESC, s.id DESC`, params).map(shape);
  const totals = rows.reduce((a, r) => {
    a.quantity += r.quantity; a.amount += r.amount; a.cost += r.cost; a.profit += r.profit;
    if (r.payment_status === 'Pending') a.pending += r.amount;
    return a;
  }, { quantity: 0, amount: 0, cost: 0, profit: 0, pending: 0 });
  for (const k of ['amount', 'cost', 'profit', 'pending']) totals[k] = round2(totals[k]);
  res.json({ sales: rows, totals });
};

exports.getOne = (req, res) => {
  const row = shape(db.get(`${SELECT} WHERE s.id = ?`, [Number(req.params.id)]));
  if (!row) throw new ApiError(404, 'Sale not found');
  res.json(row);
};

exports.nextInvoice = (req, res) => res.json({ invoice_no: nextInvoiceNo() });

exports.create = (req, res) => {
  const d = validate(req.body);
  const available = onHand(d.token_id);
  if (d.quantity > available) {
    throw new ApiError(400, available <= 0
      ? 'This product is out of stock. Add a stock purchase first.'
      : `Only ${available} in stock.`);
  }
  const unitCost = averageCost(d.token_id); // locks in the buying cost so profit doesn't change later
  const { id } = db.run(
    `INSERT INTO sales (token_id, customer_name, customer_phone, customer_email, company, quantity, unit_price, unit_cost,
                        sale_date, payment_mode, payment_status, invoice_no, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.token_id, d.customer_name, d.customer_phone, d.customer_email, d.company, d.quantity, d.unit_price, unitCost,
     d.sale_date, d.payment_mode, d.payment_status, d.invoice_no || nextInvoiceNo(), d.notes]
  );
  res.status(201).json(shape(db.get(`${SELECT} WHERE s.id = ?`, [id])));
};

exports.update = (req, res) => {
  const id = Number(req.params.id);
  const old = db.get('SELECT * FROM sales WHERE id = ?', [id]);
  if (!old) throw new ApiError(404, 'Sale not found');
  const d = validate({ ...old, ...req.body });
  const available = onHand(d.token_id, { exceptSale: id });
  if (d.quantity > available) throw new ApiError(400, `Only ${available} in stock.`);
  // keep the original cost unless the product changed
  const unitCost = d.token_id === old.token_id ? old.unit_cost : averageCost(d.token_id);
  db.run(
    `UPDATE sales SET token_id = ?, customer_name = ?, customer_phone = ?, customer_email = ?, company = ?, quantity = ?,
       unit_price = ?, unit_cost = ?, sale_date = ?, payment_mode = ?, payment_status = ?, invoice_no = ?, notes = ?
     WHERE id = ?`,
    [d.token_id, d.customer_name, d.customer_phone, d.customer_email, d.company, d.quantity, d.unit_price, unitCost,
     d.sale_date, d.payment_mode, d.payment_status, d.invoice_no || old.invoice_no, d.notes, id]
  );
  res.json(shape(db.get(`${SELECT} WHERE s.id = ?`, [id])));
};

exports.setStatus = (req, res) => {
  const id = Number(req.params.id);
  const status = req.body.payment_status;
  if (!STATUSES.includes(status)) throw new ApiError(400, 'Status must be Paid or Pending');
  const { changes } = db.run('UPDATE sales SET payment_status = ? WHERE id = ?', [status, id]);
  if (!changes) throw new ApiError(404, 'Sale not found');
  res.json(shape(db.get(`${SELECT} WHERE s.id = ?`, [id])));
};

exports.remove = (req, res) => {
  const { changes } = db.run('DELETE FROM sales WHERE id = ?', [Number(req.params.id)]);
  if (!changes) throw new ApiError(404, 'Sale not found');
  res.json({ deleted: true });
};

/* ---------------- Customers (grouped from sales) ---------------- */

exports.customers = (req, res) => {
  const params = [];
  let where = '';
  if (req.query.q) {
    where = 'WHERE s.customer_name LIKE ? OR s.customer_phone LIKE ? OR s.company LIKE ?';
    const like = `%${req.query.q}%`; params.push(like, like, like);
  }
  const rows = db.all(`
    SELECT
      MAX(s.customer_name) AS name,
      s.customer_phone AS phone,
      MAX(s.customer_email) AS email,
      MAX(s.company) AS company,
      COUNT(*) AS orders,
      SUM(s.quantity) AS units,
      SUM(s.quantity * s.unit_price) AS total_spent,
      SUM(s.quantity * (s.unit_price - s.unit_cost)) AS profit,
      SUM(CASE WHEN s.payment_status = 'Pending' THEN s.quantity * s.unit_price ELSE 0 END) AS pending,
      MIN(s.sale_date) AS first_purchase,
      MAX(s.sale_date) AS last_purchase
    FROM sales s
    ${where}
    GROUP BY lower(trim(s.customer_name)), s.customer_phone
    ORDER BY total_spent DESC
  `, params);
  res.json(rows.map((r) => ({ ...r, total_spent: round2(r.total_spent), profit: round2(r.profit), pending: round2(r.pending) })));
};

/* ---------------- Dashboard ---------------- */

function periodTotals(from, to) {
  const r = db.get(`
    SELECT COUNT(*) AS orders,
           COALESCE(SUM(quantity), 0) AS units,
           COALESCE(SUM(quantity * unit_price), 0) AS revenue,
           COALESCE(SUM(quantity * unit_cost), 0) AS cost
    FROM sales WHERE sale_date BETWEEN ? AND ?`, [from, to]);
  const purchases = db.get(`
    SELECT COALESCE(SUM(quantity * unit_cost), 0) AS v, COALESCE(SUM(quantity), 0) AS q
    FROM stock_purchases WHERE purchase_date BETWEEN ? AND ?`, [from, to]);
  return {
    orders: r.orders,
    units: r.units,
    revenue: round2(r.revenue),
    cost: round2(r.cost),
    profit: round2(r.revenue - r.cost),
    margin: r.revenue > 0 ? round2(((r.revenue - r.cost) / r.revenue) * 100) : 0,
    purchases: round2(purchases.v),
    purchased_units: purchases.q
  };
}

function monthKey(d) { return d.toLocaleDateString('en-CA').slice(0, 7); }

exports.summary = (req, res) => {
  const t = today();
  const now = new Date();
  const monthStart = t.slice(0, 8) + '01';
  const yearStart = `${now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1}-04-01`; // Indian financial year

  // last 12 months, including empty months
  const months = [];
  for (let i = 11; i >= 0; i--) months.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  const monthly = db.all(`
    SELECT substr(sale_date, 1, 7) AS month,
           SUM(quantity) AS units,
           SUM(quantity * unit_price) AS revenue,
           SUM(quantity * unit_cost) AS cost
    FROM sales WHERE substr(sale_date, 1, 7) >= ?
    GROUP BY month`, [months[0]]);
  const byMonth = Object.fromEntries(monthly.map((m) => [m.month, m]));

  const stock = tokensWithStats().filter((x) => x.active);
  const pending = db.get(`SELECT COUNT(*) n, COALESCE(SUM(quantity * unit_price), 0) v FROM sales WHERE payment_status = 'Pending'`);

  res.json({
    today: periodTotals(t, t),
    month: periodTotals(monthStart, t),
    financial_year: { from: yearStart, ...periodTotals(yearStart, t) },
    all_time: periodTotals('0000-01-01', '9999-12-31'),
    pending: { count: pending.n, amount: round2(pending.v) },
    stock: {
      units: stock.reduce((a, x) => a + Math.max(x.on_hand, 0), 0),
      value: round2(stock.reduce((a, x) => a + x.stock_value, 0)),
      low: stock.filter((x) => x.low_stock).map((x) => ({ id: x.id, name: x.name, on_hand: x.on_hand, min_stock: x.min_stock }))
    },
    monthly: months.map((m) => {
      const r = byMonth[m] || { units: 0, revenue: 0, cost: 0 };
      return { month: m, units: r.units, revenue: round2(r.revenue), cost: round2(r.cost), profit: round2(r.revenue - r.cost) };
    }),
    top_products: db.all(`
      SELECT t.name, SUM(s.quantity) AS units, SUM(s.quantity * s.unit_price) AS revenue,
             SUM(s.quantity * (s.unit_price - s.unit_cost)) AS profit
      FROM sales s JOIN tokens t ON t.id = s.token_id
      WHERE s.sale_date >= ? GROUP BY t.id ORDER BY profit DESC LIMIT 5`, [monthStart])
      .map((r) => ({ ...r, revenue: round2(r.revenue), profit: round2(r.profit) })),
    recent_sales: db.all(`${SELECT} ORDER BY s.sale_date DESC, s.id DESC LIMIT 6`).map(shape)
  });
};

/* ---------------- Reports ---------------- */

exports.report = (req, res) => {
  const from = req.query.from || today().slice(0, 8) + '01';
  const to = req.query.to || today();
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) throw new ApiError(400, 'Dates must be YYYY-MM-DD');
  if (from > to) throw new ApiError(400, '"From" date must be before "To" date');

  const group = (expr) => db.all(`
    SELECT ${expr} AS label,
           COUNT(*) AS orders,
           SUM(s.quantity) AS units,
           SUM(s.quantity * s.unit_price) AS revenue,
           SUM(s.quantity * s.unit_cost) AS cost
    FROM sales s JOIN tokens t ON t.id = s.token_id
    WHERE s.sale_date BETWEEN ? AND ?
    GROUP BY label ORDER BY label`, [from, to])
    .map((r) => ({ ...r, revenue: round2(r.revenue), cost: round2(r.cost), profit: round2(r.revenue - r.cost),
      margin: r.revenue > 0 ? round2(((r.revenue - r.cost) / r.revenue) * 100) : 0 }));

  const purchases = db.all(`
    SELECT t.name AS label, SUM(p.quantity) AS units, SUM(p.quantity * p.unit_cost) AS amount
    FROM stock_purchases p JOIN tokens t ON t.id = p.token_id
    WHERE p.purchase_date BETWEEN ? AND ?
    GROUP BY t.id ORDER BY amount DESC`, [from, to]).map((r) => ({ ...r, amount: round2(r.amount) }));

  res.json({
    from, to,
    totals: periodTotals(from, to),
    by_month: group('substr(s.sale_date, 1, 7)'),
    by_product: group('t.name'),
    by_payment_mode: group('s.payment_mode'),
    purchases
  });
};

exports.PAYMENT_MODES = PAYMENT_MODES;
