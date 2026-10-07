const router = require('express').Router();
const c = require('../controllers/tokenController');

router.get('/', c.list);          // ?active=1 for active products only
router.get('/:id', c.getOne);
router.post('/', c.create);
router.put('/:id', c.update);
router.delete('/:id', c.remove);  // archives if the product has history

module.exports = router;
