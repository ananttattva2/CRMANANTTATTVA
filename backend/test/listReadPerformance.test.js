const test = require('node:test');
const assert = require('node:assert/strict');
const Quotation = require('../src/models/Quotation');
const controller = require('../src/controllers/quotationController');
test('quotation directory fetches list fields only, retaining scoped totals and detail hydration marker', async () => {
 const snapshots=require('../src/services/dashboardSnapshotCache'), originalSnapshot=snapshots.readDashboardCollection; snapshots.readDashboardCollection=async()=>[{_id:'q2',quotationDate:new Date('2026-11-11'),items:[],status:'approved'},{_id:'q1',quotationDate:new Date('2026-11-16'),items:[{basicAmount:120}],status:'approved'}];
 const originalFind=Quotation.find, originalCount=Quotation.countDocuments; let selected, filter;
 const query={select(value){selected=value;return this;},sort(){return this;},populate(){throw Error('Directory must not populate unused detail actors');},async lean(){return [{_id:'q1',items:[{basicAmount:120}],status:'approved'}];}};
 Quotation.find=value=>{filter=value;return query;}; Quotation.countDocuments=async()=>2;
 try { let result;await controller.listQuotations({query:{view:'directory'},user:{role:'admin'}},{json(value){result=value;}});
 assert.ok(selected.includes('items.basicAmount'));assert.ok(!selected.split(' ').includes('items'));assert.ok(!selected.includes('revisionHistory'));assert.ok(!selected.includes('scopeOfWork'));assert.equal(result.quotations[0]._listOnly,true);assert.equal(result.pagination.total,2);assert.equal(result.quotations[0]._id,'q1');assert.ok(filter);
 }finally{snapshots.readDashboardCollection=originalSnapshot;Quotation.find=originalFind;Quotation.countDocuments=originalCount;}
});

test('quotation directory restricts results and totals to the signed-in creator across regular roles', async t => {
 const mongoose = require('mongoose');
 const snapshots = require('../src/services/dashboardSnapshotCache');
 const owner = new mongoose.Types.ObjectId();
 const other = new mongoose.Types.ObjectId();
 const rows = [
  { _id: 'mine', createdBy: owner, quotationDate: new Date('2026-11-16') },
  { _id: 'colleague', createdBy: other, quotationDate: new Date('2026-11-17') }
 ];
 const query = { select() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; } };
 const filters = [];
 const ownedRows = filter => {
  const access = filter.$and?.[1];
  if (!access) return [...rows];
  assert.deepEqual(access, { $or: [{ createdBy: { $in: [owner] } }] });
  return rows.filter(row => row.createdBy.equals(owner));
 };
 t.mock.method(Quotation, 'find', () => query);
 t.mock.method(snapshots, 'readDashboardCollection', async (_model, filter) => {
  filters.push(filter);
  return ownedRows(filter);
 });
 t.mock.method(Quotation, 'countDocuments', async filter => {
  assert.deepEqual(filter, filters.at(-1));
  return ownedRows(filter).length;
 });
 for (const user of [
  { _id: owner, role: 'sales' },
  { _id: owner, role: 'manager' },
  { _id: owner, role: 'sales', roles: ['Finance'] },
  { _id: owner, role: 'admin' },
  { _id: owner, role: 'sales', roles: ['Super Admin'] }
 ]) {
  let result;
  await controller.listQuotations({ user, query: { view: 'directory', search: 'company', createdBy: String(other), limit: '1' } }, { json(value) { result = value; } });
  const all = user.role === 'admin' || user.roles?.includes('Super Admin');
  assert.deepEqual(result.quotations.map(row => row._id), [all ? 'colleague' : 'mine']);
  assert.equal(result.pagination.total, all ? 2 : 1);
 }
});
