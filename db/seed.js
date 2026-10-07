// Optional: fills an EMPTY database with sample products, purchases and sales
// so you can see the dashboard working.  Run:  npm run seed
const db = require('./database');

const PRODUCTS = [
  { name: 'ePass2003 Token', brand: 'Longmai', category: 'USB Token', purchase_price: 280, sale_price: 550, min_stock: 10 },
  { name: 'ProxKey Token', brand: 'Watchdata', category: 'USB Token', purchase_price: 300, sale_price: 600, min_stock: 10 },
  { name: 'HyperPKI Token', brand: 'HyperSecu', category: 'USB Token', purchase_price: 320, sale_price: 650, min_stock: 5 },
  { name: 'Class 3 Signing - 2 Yr', brand: 'eMudhra', category: 'DSC Certificate', purchase_price: 900, sale_price: 1800, min_stock: 10 },
  { name: 'Class 3 Combo - 2 Yr', brand: 'Capricorn', category: 'DSC Certificate', purchase_price: 1300, sale_price: 2500, min_stock: 5 },
  { name: 'DGFT Certificate - 1 Yr', brand: 'Vsign', category: 'DSC Certificate', purchase_price: 1600, sale_price: 3000, min_stock: 3 }
];
const CUSTOMERS = [
  ['Ramesh Kumar', '9848012345', 'Kumar Traders'], ['Lakshmi Reddy', '9000011122', ''],
  ['Suresh & Co', '9123456780', 'Suresh & Co CA'], ['Anil Sharma', '9876543210', 'Sharma Exports'],
  ['Priya Nair', '9988776655', ''], ['Venkat Rao', '9440022334', 'VR Constructions']
];
const MODES = ['Cash', 'UPI', 'UPI', 'Bank', 'Cash'];

(async () => {
  await db.init();
  if (db.get('SELECT COUNT(*) n FROM tokens').n > 0) {
    console.log('Database already has data - seed skipped.');
    return;
  }
  const iso = (d) => d.toLocaleDateString('en-CA');
  const now = new Date();
  db.transaction(() => {
    const ids = PRODUCTS.map((p) => db.run(
      'INSERT INTO tokens (name, brand, category, purchase_price, sale_price, min_stock) VALUES (?, ?, ?, ?, ?, ?)',
      [p.name, p.brand, p.category, p.purchase_price, p.sale_price, p.min_stock]).id);

    let inv = 0;
    for (let m = 5; m >= 0; m--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - m, 1);
      ids.forEach((id, i) => {
        const p = PRODUCTS[i];
        const qty = 8 + ((i * 7 + m * 3) % 12);
        const cost = p.purchase_price + ((m + i) % 3) * 10;
        db.run('INSERT INTO stock_purchases (token_id, supplier, quantity, unit_cost, purchase_date, invoice_no) VALUES (?, ?, ?, ?, ?, ?)',
          [id, p.category === 'USB Token' ? 'Hyderabad Token Distributors' : p.brand + ' Partner Portal', qty, cost, iso(monthStart), `PO-${100 + inv}`]);
        const sold = qty - 2 - ((i + m) % 3);
        let left = sold, n = 0;
        while (left > 0) {
          const q = Math.min(left, 1 + ((n + i) % 3));
          const day = new Date(monthStart.getFullYear(), monthStart.getMonth(), Math.min(2 + n * 4 + i, 27));
          if (day > now) break;
          const c = CUSTOMERS[(n + i + m) % CUSTOMERS.length];
          inv++;
          db.run(`INSERT INTO sales (token_id, customer_name, customer_phone, company, quantity, unit_price, unit_cost, sale_date,
                   payment_mode, payment_status, invoice_no) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, c[0], c[1], c[2], q, p.sale_price - ((n % 3) * 25), cost, iso(day), MODES[(n + i) % MODES.length],
             (m === 0 && n % 4 === 1) ? 'Pending' : 'Paid', `INV-${day.getFullYear()}-${String(inv).padStart(4, '0')}`]);
          left -= q; n++;
        }
      });
    }
  });
  console.log('Sample data added.');
})();
