const test=require('node:test'),assert=require('node:assert/strict');
const {invoicePartyDetails,validGst}=require('../src/services/invoicePartyDetails');
test('PI fills blank GSTIN from Client Master compliance and preserves a supplied valid GSTIN',()=>{
 const gst='24ABCDE1234F1Z5';
 assert.equal(invoicePartyDetails({gstNumber:''},{data:{compliance:{gst}}}).gstNumber,gst);
 assert.equal(invoicePartyDetails({gstNumber:'27ABCDE1234F1Z5'},{data:{compliance:{gst}}}).gstNumber,'27ABCDE1234F1Z5');
 assert.equal(invoicePartyDetails({gstNumber:'NA'},{data:{basic:{gstin:gst}}}).gstNumber,gst);
 assert.equal(validGst(''),false);assert.equal(validGst('NA'),false);assert.equal(validGst(gst),true);
});
test('resolved client GSTIN appears in both Buyer and Consignee blocks',async()=>{
 const details=invoicePartyDetails(null,{data:{compliance:{gst:'24ABCDE1234F1Z5'}}});details.companyName='Test Buyer';
 const pdf=(await require('../src/services/proformaEmail').invoicePdf({leadDetails:details,items:[{serviceCategory:'Consultancy',unit:'1',basicAmount:1000}],proformaNumber:'ATPI/26-27/999'})).toString();
 assert.equal((pdf.match(/24ABCDE1234F1Z5/g)||[]).length,2);
});
