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

const { calculateMtPerYear, needsPieceWeight, formatMtPerYear } = require('../../shared/productQuantity.cjs');
test('annual MT converts pieces in kg and grams and monthly versus yearly quantities', () => {
 assert.equal(calculateMtPerYear({quantity:'17000000',uom:'NOS',period:'month',pieceWeight:'0.005',pieceWeightUom:'kg'}),1020);
 assert.equal(calculateMtPerYear({quantity:'17000000',uom:'nos',period:'month',pieceWeight:'5',pieceWeightUom:'g'}),1020);
 assert.equal(calculateMtPerYear({quantity:'17000000',uom:'nos',period:'year',pieceWeight:'5',pieceWeightUom:'g'}),85);
 assert.equal(calculateMtPerYear({quantity:'2.5',uom:'boxes',period:'month',pieceWeight:'2',pieceWeightUom:'kg'}),0.06);
});
test('KG and MT quantities bypass piece weight and never use stale piece inputs', () => {
 for(const uom of ['KG','kg',' kgs ','kilograms','MT','mt','metric tonnes']) assert.equal(needsPieceWeight({uom}),false);
 assert.equal(needsPieceWeight({uom:'NOS'}),true);
 assert.equal(calculateMtPerYear({quantity:'6000',uom:'KG',period:'month',pieceWeight:'999',pieceWeightUom:'g'}),72);
 assert.equal(calculateMtPerYear({quantity:'6000',uom:'kg',period:'year'}),6);
 assert.equal(calculateMtPerYear({quantity:'2',uom:'MT',period:'month'}),24);
 assert.equal(calculateMtPerYear({quantity:'2',uom:'mt',period:'year'}),2);
});
test('incomplete and invalid inputs stay uncalculated while zero is displayed', () => {
 const row={quantity:'100',uom:'nos',period:'month',pieceWeight:'5',pieceWeightUom:'g'};
 for(const patch of [{quantity:''},{quantity:'bad'},{quantity:'-1'},{pieceWeight:''},{pieceWeight:'-1'},{pieceWeight:'1e3'},{pieceWeightUom:''},{pieceWeightUom:'mt'},{uom:''},{period:''}]) assert.equal(calculateMtPerYear({...row,...patch}),null);
 assert.equal(formatMtPerYear({...row,quantity:'0'}),'0');
 assert.equal(calculateMtPerYear({...row,pieceWeight:'0'}),0);
 assert.equal(calculateMtPerYear({quantity:'6,000 KG/MONTH'}),72);
 assert.equal(calculateMtPerYear({...row,quantity:'9'.repeat(400)}),null);
});
test('saved piece weight survives scoped hydration and API rejects invalid inputs', () => {
 const row={quantity:'100',uom:'nos',period:'month',pieceWeight:'2.5',pieceWeightUom:'g'};
 const data={cte:{plantWiseDetails:[{ctoProductRows:[row]}]}};
 assert.deepEqual(normalizeProductQuantities(data).cte.plantWiseDetails[0].ctoProductRows[0],row);
 assert.equal(validateProductQuantities(data),'');
 for(const patch of [{pieceWeight:'abc'},{pieceWeight:'-1'},{pieceWeightUom:'ton'}]) assert.ok(validateProductQuantities({cte:{plantWiseDetails:[{ctoProductRows:[{...row,...patch}]}]}}));
});
