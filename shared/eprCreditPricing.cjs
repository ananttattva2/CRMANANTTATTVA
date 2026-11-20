const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const isCredit = item => normalize(item.businessCategory) === 'eprcredit';
const tariffs = { '1recycling': [1.30, 1.20], '1eol': [1.30, 1.20], '2recycling': [2.40, 2.40], '2eol': [0.95, 0.95], '3recycling': [4.75, 4.75], '3eol': [0.85, 0.85] };
function tariffKey(item) {
  const service = normalize(item.servicesOffered || item.applicableService);
  const category = service.match(/(?:category|cat)([123])/);
  return category ? category[1] + (service.includes('eol') ? 'eol' : service.includes('recycl') ? 'recycling' : '') : '';
}
function basis(item) {
  return JSON.stringify([item.id || '', item.assignedServiceId || '', normalize(item.businessCategory), normalize(item.eprCategory || item.serviceCategory), normalize(item.piboCategory || item.applicantType), normalize(item.servicesOffered || item.applicableService), item.creditRateBand || 'below100']);
}
function standardRate(item) {
  const rates = tariffs[tariffKey(item)];
  return rates ? rates[item.creditRateBand === 'above100' ? 1 : 0] : null;
}
function rate(item, trustedApproval = item.creditRateApproval) {
  if (!isCredit(item)) return Number(item.basicAmount) || 0;
  if (trustedApproval?.basis === basis(item) && Number.isFinite(trustedApproval.rate) && trustedApproval.rate >= 0) return trustedApproval.rate;
  return standardRate(item);
}
module.exports = { isCredit, tariffKey, basis, standardRate, rate, tariffs, approverEmail: 'anand.padhya@ananttattva.com' };
