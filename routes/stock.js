const router = require('express').Router();
const c = require('../controllers/stockController');

router.get('/summary', c.summary);                // current stock + value per product
router.get('/purchases', c.listPurchases);        // ?token_id=&from=&to=&q=
router.post('/purchases', c.createPurchase);
router.put('/purchases/:id', c.updatePurchase);
router.delete('/purchases/:id', c.deletePurchase);

module.exports = router;
