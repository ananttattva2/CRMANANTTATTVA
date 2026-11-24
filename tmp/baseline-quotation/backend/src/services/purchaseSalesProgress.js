const { purchaseReadiness, calculatePurchaseStatus } = require('./purchaseDataService');

module.exports = function summarizePurchaseSales(records) {
  return Object.fromEntries(records.map((record) => [String(record.clientId), {
    complete: purchaseReadiness(record).ready,
    status: calculatePurchaseStatus(record)
  }]));
};
