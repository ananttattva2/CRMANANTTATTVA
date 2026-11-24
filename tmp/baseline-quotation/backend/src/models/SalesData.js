const mongoose = require('mongoose');
const PurchaseData = require('./PurchaseData');

// Sales follows the same persisted workflow shape as Purchase, but lives in its
// own collection so the two modules can be reviewed independently.
module.exports = mongoose.model('SalesData', PurchaseData.schema.clone());
