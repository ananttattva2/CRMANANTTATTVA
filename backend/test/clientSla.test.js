const test = require('node:test');
const assert = require('node:assert/strict');
const { validationError, cleanSla } = require('../src/services/clientSla');
const Client = require('../src/models/Client');
const { getClientSla, updateClientSla } = require('../src/controllers/clientController');
const user = { _id: '64b000000000000000000001', role: 'admin', name: 'SLA User' };
const id = '64b000000000000000000002';
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } }; }
test('SLA date gate rejects missing, impossible and reversed date ranges', () => {
 assert.match(validationError({}), /From Date/);
 assert.match(validationError({ fromDate: '2026-10-06' }), /To Date/);
 assert.match(validationError({ fromDate: '2026-02-30', toDate: '2026-10-06' }), /valid date/);
 assert.match(validationError({ fromDate: '2026-10-06', toDate: '2026-10-05' }), /on or after/);
 assert.equal(validationError({ fromDate: '2024-02-29', toDate: '2024-02-29', status: 'No' }), '');
});
test('SLA proof cleaning excludes unsafe URLs and preserves remark and uploaded file', () => {
 const sla = cleanSla({ remark: ' SLA terms ', status: 'Yes', proofs: [{url: 'javascript:alert(1)'}, {name: 'Terms.pdf', secureUrl: 'https://example.test/terms.pdf', publicId: 'sla/terms'}] });
 assert.equal(sla.remark, 'SLA terms'); assert.equal(sla.proofs.length, 1); assert.equal(sla.proofs[0].name, 'Terms.pdf');
});
test('SLA API does not save incomplete dates, saves valid data and returns it on reopen', async (t) => {
 let saves = 0;
 const record = { sla: {}, markModified() {}, async save() { saves++; } };
 t.mock.method(Client, 'findOne', () => ({ select: async () => record, then(resolve, reject) { return Promise.resolve(record).then(resolve, reject); } }));
 const firstVisit = response(); await getClientSla({ params: {id}, user }, firstVisit);
 assert.equal(firstVisit.body.ready, false);
 const incomplete = response();
 await updateClientSla({ params: {id}, user, body: {status:'Yes',fromDate:'2026-10-06'} }, incomplete);
 assert.equal(incomplete.statusCode, 400); assert.equal(incomplete.body.ready, false); assert.equal(saves,0);
 const saved = response();
 await updateClientSla({ params: {id}, user, body: {status:'No',remark:'Pending signature',fromDate:'2026-10-06',toDate:'2027-10-05'} }, saved);
 assert.equal(saved.body.ready,true); assert.equal(saves,1); assert.equal(saved.body.sla.updatedByName,'SLA User');
 const reopened = response(); await getClientSla({ params: {id}, user }, reopened);
 assert.equal(reopened.body.ready,true); assert.equal(reopened.body.sla.remark,'Pending signature');
});
test('SLA API denies records outside the visible client scope', async (t) => {
 t.mock.method(Client, 'findOne', () => ({select: async () => null, then(resolve,reject) {return Promise.resolve(null).then(resolve,reject);} }));
 const res = response(); await getClientSla({params:{id},user},res); assert.equal(res.statusCode,404);
});
