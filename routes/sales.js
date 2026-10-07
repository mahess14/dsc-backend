const router = require('express').Router();
const c = require('../controllers/salesController');

router.get('/summary', c.summary);            // dashboard figures
router.get('/report', c.report);              // ?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/customers', c.customers);        // customers grouped from sales, ?q=
router.get('/next-invoice', c.nextInvoice);
router.get('/', c.list);                      // ?from=&to=&token_id=&status=&q=
router.get('/:id', c.getOne);
router.post('/', c.create);
router.put('/:id', c.update);
router.patch('/:id/status', c.setStatus);     // { payment_status: 'Paid' | 'Pending' }
router.delete('/:id', c.remove);

module.exports = router;
