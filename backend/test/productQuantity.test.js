const { test } = require('node:test');
const assert = require('node:assert/strict');
const { splitProductQuantity, normalizeProductQuantities, validateProductQuantities } = require('../../shared/productQuantity.cjs');
test('splits existing units, periods, commas, decimals and zero without losing row fields', () => {
 for (const [quantity, number, uom, period] of [['17000000 NOS/MONTH','17000000','nos','month'],['6,000 KG/YEAR','6000','kg','year'],['0 nos/month','0','nos','month'],['1.25 MT per annum','1.25','mt','year']]) assert.deepEqual(splitProductQuantity({ productName:'Cup', quantity }), {productName:'Cup',quantity:number,uom,period});
});
test('normalizes every service independently and is idempotent', () => {
 const data = { serviceDetailsByAssignedServiceId: { a: { cte: { plantWiseDetails:[{ctoProductRows:[{quantity:'80000 nos/month'}]}] } }, b: { cte: { plantWiseDetails:[{ctoProductRows:[{quantity:'2 kg/year'}]}] } } } };
 const result = normalizeProductQuantities(data);
 assert.equal(result.serviceDetailsByAssignedServiceId.a.cte.plantWiseDetails[0].ctoProductRows[0].uom,'nos');
 assert.equal(result.serviceDetailsByAssignedServiceId.b.cte.plantWiseDetails[0].ctoProductRows[0].period,'year');
 assert.deepEqual(normalizeProductQuantities(result), result);
 assert.equal(data.serviceDetailsByAssignedServiceId.a.cte.plantWiseDetails[0].ctoProductRows[0].quantity,'80000 nos/month');
});
test('preserves ambiguous historical values for review and rejects invalid new quantities', () => {
 assert.deepEqual(splitProductQuantity({quantity:'unknown'}),{quantity:'unknown'});
 assert.ok(validateProductQuantities({cte:{plantWiseDetails:[{ctoProductRows:[splitProductQuantity({quantity:'1e3'})]}]}}));
 for (const quantity of ['text','-1','1e3']) assert.ok(validateProductQuantities({cte:{plantWiseDetails:[{ctoProductRows:[{quantity}]}]}}));
});
