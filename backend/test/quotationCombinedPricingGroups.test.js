const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Quotation = require('../src/models/Quotation');

const page = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/pages/Quotations.jsx'), 'utf8');
const controller = fs.readFileSync(path.resolve(__dirname, '../src/controllers/quotationController.js'), 'utf8');

function pricingRows(quotation, items) {
  const vm = require('node:vm');
  const source = page.slice(page.indexOf('function quotationItemKey('), page.indexOf('function scopePresetKeyForAmount('));
  return vm.runInNewContext(`${source}\ncombinedPricingRows(quotation, items);`, { quotation, items });
}

test('interleaved group members render together with exactly one amount per saved group', () => {
  const items = Array.from({ length: 15 }, (_, index) => ({ assignedServiceId: `service-${index + 1}` }));
  const quotation = { pricingMode: 'combined', combinedPricingGroups: [
    { id: 'g1', itemKeys: [1, 2, 3, 4, 5].map(n => `service-${n}`), basicAmount: 125000 },
    { id: 'g2', itemKeys: [6, 7, 8, 10, 11].map(n => `service-${n}`), basicAmount: 125000 },
    { id: 'g3', itemKeys: [9, 12, 13, 14, 15].map(n => `service-${n}`), basicAmount: 125000 }
  ] };
  const result = pricingRows(quotation, items);
  assert.deepEqual(Array.from(result, row => row.index + 1), [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 9, 12, 13, 14, 15]);
  const amountRows = result.filter(row => row.firstInGroup);
  assert.equal(amountRows.length, 3);
  assert.deepEqual(Array.from(amountRows, row => row.groupSize), [5, 5, 5]);
  assert.equal(amountRows.reduce((sum, row) => sum + row.group.basicAmount, 0), 375000);
  assert.deepEqual(items.map(item => item.assignedServiceId), Array.from({ length: 15 }, (_, index) => `service-${index + 1}`));
});

test('legacy combined pricing and unassigned services remain visible without duplicating rows', () => {
  const items = [{ assignedServiceId: 'one', basicAmount: 100 }, { assignedServiceId: 'two', basicAmount: 200 }];
  const legacy = pricingRows({ pricingMode: 'combined', combinedBasicAmount: 300 }, items);
  assert.equal(legacy[0].groupSize, 2);
  assert.equal(legacy.filter(row => row.firstInGroup).length, 1);
  const partial = pricingRows({ combinedPricingGroups: [{ id: 'group', itemKeys: ['two'], basicAmount: 200 }] }, items);
  assert.deepEqual(Array.from(partial, row => row.item.assignedServiceId), ['two', 'one']);
  assert.equal(partial[1].group.basicAmount, 100);
});

test('Quotation persists combined pricing groups with service membership and amount', () => {
  const groupPath = Quotation.schema.path('combinedPricingGroups');
  assert.ok(groupPath);
  const groupSchema = groupPath.schema;
  assert.ok(groupSchema.path('id'));
  assert.ok(groupSchema.path('name'));
  assert.ok(groupSchema.path('itemKeys'));
  assert.ok(groupSchema.path('basicAmount'));
});

test('Combined Pricing groups start with unassigned services and use row removal', () => {
  assert.match(page, /Add Combined Group/);
  assert.doesNotMatch(page, /> Add Services</);
  assert.doesNotMatch(page, /Select unassigned services/);
  assert.match(page, /current\.items\.map\(quotationItemKey\)/);
  assert.match(page, /createCombinedPricingGroup\(groups\.length, unassignedKeys\)/);
  assert.match(page, /Remove from this group/);
  assert.match(page, /Each group starts with all currently unassigned services/);
});

test('Combined group validation rejects empty, duplicate, and unassigned services', () => {
  assert.match(controller, /select at least one quotation service/);
  assert.match(controller, /cannot belong to more than one group/);
  assert.match(controller, /assign this service to a combined pricing group/);
  assert.match(page, /assign this service to a combined pricing group/);
});

test('Quotation preview, PDF view, and download merge amount cells per pricing group', () => {
  assert.match(page, /function combinedPricingRows/);
  assert.match(page, /const rows = items\.map/);
  assert.match(page, /groupByItemKey\.get\(quotationItemKey\(item, index\)\)/);
  assert.match(page, /while \(runEnd < rows\.length && rows\[runEnd\]\.group\.id === row\.group\.id\)/);
  assert.match(page, /rowSpan=\{combined \? groupSize : undefined\}/);
  assert.match(page, /rowspan="\$\{groupSize\}"/);
  assert.match(page, /combined \? group\.basicAmount : item\.basicAmount/);
});

test('Quotation PDF tables share grouped display order and generate continuous serial numbers', () => {
  assert.match(page, /displayRows\.map\(\(\{ item, index, group, groupSize, firstInGroup \}, rowIndex\)/);
  assert.match(page, /\{rowIndex \+ 1\}/);
  assert.match(page, /<tbody>\{displayRows\.map\(\(\{ item \}, index\)/);
  assert.match(page, /\$\{displayRows\.map\(\(\{ item \}, index\)/);
});
