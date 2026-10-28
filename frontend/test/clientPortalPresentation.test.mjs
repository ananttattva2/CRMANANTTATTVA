import test from 'node:test'
import assert from 'node:assert/strict'
import { collectDetails, companyDocuments, handlingTeam } from '../src/utils/clientPortalPresentation.mjs'
test('nested company data becomes labelled fields and document actions without file metadata',()=>{
 const value={gstNumber:'GST123',gstFile:{name:'gst.pdf',url:'https://example.com/gst.pdf',secureUrl:'https://example.com/gst.pdf',bytes:999,width:612,type:'application/pdf'},empty:'',plantWiseDetails:[{plantName:'Plant One',ctoProductRows:[{productName:'Process water',quantity:380}]}]}
 const result=collectDetails(value)
 assert.equal(result.documents.length,1)
 assert.ok(result.fields.some(field=>field.label==='GST Number'&&field.value==='GST123'))
 assert.ok(result.fields.some(field=>field.label==='Product Name'&&field.value==='Process water'))
 assert.ok(!result.fields.some(field=>/url|bytes|width|type|empty/i.test(field.label)))
 assert.ok(!result.fields.some(field=>field.value.includes('https://')))
})
test('documents and repeated account managers are deduplicated without losing services',()=>{
 const file={name:'gst.pdf',url:'https://example.com/gst.pdf'}
 const client={clientMaster:[{compliance:{gstFile:file}},{compliance:{gstFile:file}}],assignments:[{spoc:{name:'Manager',email:'manager@example.com'}},{spoc:{name:'Manager',email:'manager@example.com'}}],services:[{eprCategory:'Plastic',servicesOffered:'Registration',subApplicantType:'Producer'},{eprCategory:'Plastic',servicesOffered:'Registration',subApplicantType:'Importer'}]}
 assert.equal(companyDocuments(client).length,1)
 const team=handlingTeam(client)
 assert.equal(team.length,1)
 assert.equal(team[0].services.length,2)
 assert.ok(team[0].services[0].includes('Producer'))
})
test('unsafe document URLs are never converted into clickable actions',()=>{
 const result=collectDetails({document:{url:'javascript:alert(1)',name:'Unsafe'}})
 assert.equal(result.documents.length,0)
})
