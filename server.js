const express = require('express');
const cors = require('cors');
const db = require('./db/database');

const PORT = process.env.PORT || 5000;
const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/tokens', require('./routes/tokens'));
app.use('/api/stock', require('./routes/stock'));
app.use('/api/sales', require('./routes/sales'));

app.use((req, res) => res.status(404).json({ error: `No route ${req.method} ${req.path}` }));

// Controllers throw ApiError(status, message); anything else is a 500.
app.use((err, req, res, _next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

db.init().then(() => {
  app.listen(PORT, () => {
    console.log(`DSC Ledger API running on http://localhost:${PORT}`);
    console.log(`Database: ${db.DB_FILE}`);
  });
}).catch((e) => {
  console.error('Could not open the database:', e);
  process.exit(1);
});
