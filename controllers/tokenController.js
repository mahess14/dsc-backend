// Products you buy and sell: USB tokens (ePass2003, ProxKey...) and DSC certificates.
const db = require('../db/database');

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const CATEGORIES = ['USB Token', 'DSC Certificate', 'Other'];
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Stock and profit figures for every product (or one product). */
function tokensWithStats(tokenId = null) {
  const rows = db.all(`
    SELECT t.*,
      COALESCE(p.qty, 0)     AS purchased_qty,
      COALESCE(p.value, 0)   AS purchased_value,
      COALESCE(s.qty, 0)     AS sold_qty,
      COALESCE(s.revenue, 0) AS revenue,
      COALESCE(s.cogs, 0)    AS cogs
    FROM tokens t
    LEFT JOIN (SELECT token_id, SUM(quantity) qty, SUM(quantity * unit_cost) value
               FROM stock_purchases GROUP BY token_id) p ON p.token_id = t.id
    LEFT JOIN (SELECT token_id, SUM(quantity) qty, SUM(quantity * unit_price) revenue, SUM(quantity * unit_cost) cogs
               FROM sales GROUP BY token_id) s ON s.token_id = t.id
    ${tokenId ? 'WHERE t.id = ?' : ''}
    ORDER BY t.active DESC, t.name COLLATE NOCASE
  `, tokenId ? [tokenId] : []);

  return rows.map((r) => {
    const onHand = r.purchased_qty - r.sold_qty;
    const avgCost = r.purchased_qty > 0 ? r.purchased_value / r.purchased_qty : r.purchase_price;
    return {
      ...r,
      active: !!r.active,
      on_hand: onHand,
      avg_cost: round2(avgCost),
      stock_value: round2(Math.max(onHand, 0) * avgCost),
      revenue: round2(r.revenue),
      cogs: round2(r.cogs),
      profit: round2(r.revenue - r.cogs),
      low_stock: !!r.active && onHand <= r.min_stock
    };
  });
}

function validate(body, partial = false) {
  const out = {};
  if (!partial || body.name !== undefined) {
    if (!body.name || !String(body.name).trim()) throw new ApiError(400, 'Product name is required');
    out.name = String(body.name).trim();
  }
  if (body.brand !== undefined) out.brand = String(body.brand || '').trim();
  if (!partial || body.category !== undefined) {
    out.category = CATEGORIES.includes(body.category) ? body.category : 'USB Token';
  }
  for (const k of ['purchase_price', 'sale_price']) {
    if (body[k] !== undefined) {
      const v = Number(body[k]);
      if (!Number.isFinite(v) || v < 0) throw new ApiError(400, `${k.replace('_', ' ')} must be 0 or more`);
      out[k] = round2(v);
    }
  }
  if (body.min_stock !== undefined) {
    const v = parseInt(body.min_stock, 10);
    if (!Number.isInteger(v) || v < 0) throw new ApiError(400, 'Low-stock level must be 0 or more');
    out.min_stock = v;
  }
  if (body.active !== undefined) out.active = body.active ? 1 : 0;
  return out;
}

exports.list = (req, res) => {
  let tokens = tokensWithStats();
  if (req.query.active === '1') tokens = tokens.filter((t) => t.active);
  res.json(tokens);
};

exports.getOne = (req, res) => {
  const [token] = tokensWithStats(Number(req.params.id));
  if (!token) throw new ApiError(404, 'Product not found');
  res.json(token);
};

exports.create = (req, res) => {
  const data = validate(req.body);
  const dup = db.get('SELECT id FROM tokens WHERE lower(name) = lower(?)', [data.name]);
  if (dup) throw new ApiError(409, `A product named "${data.name}" already exists`);
  const cols = Object.keys(data);
  const { id } = db.run(
    `INSERT INTO tokens (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map((c) => data[c])
  );
  res.status(201).json(tokensWithStats(id)[0]);
};

exports.update = (req, res) => {
  const id = Number(req.params.id);
  if (!db.get('SELECT id FROM tokens WHERE id = ?', [id])) throw new ApiError(404, 'Product not found');
  const data = validate(req.body, true);
  if (data.name) {
    const dup = db.get('SELECT id FROM tokens WHERE lower(name) = lower(?) AND id <> ?', [data.name, id]);
    if (dup) throw new ApiError(409, `A product named "${data.name}" already exists`);
  }
  const cols = Object.keys(data);
  if (cols.length) {
    db.run(`UPDATE tokens SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => data[c]), id]);
  }
  res.json(tokensWithStats(id)[0]);
};

exports.remove = (req, res) => {
  const id = Number(req.params.id);
  if (!db.get('SELECT id FROM tokens WHERE id = ?', [id])) throw new ApiError(404, 'Product not found');
  const used = db.get(`SELECT (SELECT COUNT(*) FROM sales WHERE token_id = ?) + (SELECT COUNT(*) FROM stock_purchases WHERE token_id = ?) AS n`, [id, id]).n;
  if (used > 0) {
    // keep history intact: hide the product instead of deleting it
    db.run('UPDATE tokens SET active = 0 WHERE id = ?', [id]);
    return res.json({ archived: true, message: 'Product has sales or purchases, so it was archived instead of deleted.' });
  }
  db.run('DELETE FROM tokens WHERE id = ?', [id]);
  res.json({ deleted: true });
};

exports.ApiError = ApiError;
exports.tokensWithStats = tokensWithStats;
exports.round2 = round2;
exports.CATEGORIES = CATEGORIES;
