const express = require('express');
const controller = require('../controllers/supportTicketController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.get('/', requireAuth, controller.listTickets);
router.post('/', requireAuth, controller.createTicket);
router.put('/:id', requireAuth, controller.updateTicket);

module.exports = router;
