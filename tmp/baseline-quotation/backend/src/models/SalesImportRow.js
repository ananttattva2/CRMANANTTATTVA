const mongoose = require('mongoose');
const PurchaseImportRow = require('./PurchaseImportRow');

module.exports = mongoose.model('SalesImportRow', PurchaseImportRow.schema.clone());
