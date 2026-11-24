from pathlib import Path
base=Path('.')
for name in ['purchaseDataController','salesDataController']:
 p=base/f'backend/src/controllers/{name}.js';s=p.read_text();s="const { receiptTracking } = require('../services/dataReceiptTracking');\n"+s
 s=s.replace('existingProofs.get(String(file.proofId))).filter(Boolean)',"existingProofs.has(String(file.proofId)) ? { ...existingProofs.get(String(file.proofId)), receiptStage: ['partial', 'complete'].includes(file.receiptStage) ? file.receiptStage : '' } : null).filter(Boolean)")
 s=s.replace("const ordinaryFiles = cleanEvidenceFiles((Array.isArray(row.files) ? row.files : []).filter((file) => !file?.proofId));", "const sourceFiles = (Array.isArray(row.files) ? row.files : []).filter((file) => !file?.proofId);\n      const ordinaryFiles = cleanEvidenceFiles(sourceFiles).map(file => ({ ...file, receiptStage: ['partial', 'complete'].includes(sourceFiles.find(source => (source.url || source.secureUrl) === (file.url || file.secureUrl))?.receiptStage) ? sourceFiles.find(source => (source.url || source.secureUrl) === (file.url || file.secureUrl)).receiptStage : '' }));\n      const files = [...requestedProofs, ...ordinaryFiles].slice(0, 20);\n      const tracking = receiptTracking({ ...row, particular }, existingRows.get(particular) || {}, files, req.user);")
 s=s.replace('return { particular, partialDataReceived:', 'return { ...tracking, particular, partialDataReceived:')
 # tracking flags already equivalent but timestamp/history carried
 s=s.replace("catch (error) { console.error('Purchase checklist update failed', error);", "catch (error) { if (error.status === 400) return res.status(400).json({ error: error.message }); console.error('Purchase checklist update failed', error);")
 s=s.replace("catch (error) { console.error('Sales checklist update failed', error);", "catch (error) { if (error.status === 400) return res.status(400).json({ error: error.message }); console.error('Sales checklist update failed', error);")
 p.write_text(s)
p=base/'backend/src/services/purchaseDataService.js';s=p.read_text().replace('return { particular, partialDataReceived:', "return { partialReceivedAt: row.partialReceivedAt || '', completeReceivedAt: row.completeReceivedAt || '', receiptHistory: Array.isArray(row.receiptHistory) ? row.receiptHistory : [], particular, partialDataReceived:");p.write_text(s)
for name,state in [('PurchaseDataWorkspace','purchase'),('SalesDataPanel','sales')]:
 p=base/f'frontend/src/features/clientMaster/{name}.jsx';s=p.read_text();s=s.replace('async (index, fileList) =>', "async (index, fileList, receiptStage = '') =>").replace('async (index, files) =>', "async (index, files, receiptStage = '') =>")
 s=s.replace("form.append('financialYear', financialYear);", "form.append('financialYear', financialYear); form.append('receiptStage', receiptStage);")
 s=s.replace('...uploaded].slice(0, 20)', '...uploaded.map(file => ({ ...file, receiptStage }))].slice(0, 20)')
 # prevent stale pre-save state from replacing canonical server timestamps
 s=s.replace(f'set{state.capitalize()}(working);',f'if (!ordinaryFiles.length) set{state.capitalize()}(withExplanationStages(working));')
 p.write_text(s)
p=base/'backend/src/controllers/purchaseProofController.js';s=p.read_text();s=s.replace('proofReference(proof, false)].slice(0, 20)', "{ ...proofReference(proof, false), receiptStage: ['partial', 'complete'].includes(req.body.receiptStage) ? req.body.receiptStage : '' }].slice(0, 20)");p.write_text(s)
