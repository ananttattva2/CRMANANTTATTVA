import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Eye, ExternalLink } from 'lucide-react';
import OutlookMsgViewer, { isEmailProof } from '../features/clientMaster/OutlookMsgViewer';
import ArReviewDialog from './ArReviewDialog';

const sourceUrl = file => {
  const url = file?.secureUrl || file?.url || file?.secure_url || '';
  return /^https?:\/\//i.test(url) || /^\/api\/purchase-proofs\/[a-f\d]{24}\/download$/i.test(url) ? url : '';
};
export default function ArProofLinks({ files = [] }) {
  const [preview, setPreview] = useState(null);
  return <><div className="ar-proof-links">{files.length ? files.map((file, index) => <button key={`${file.proofId || file.name}:${index}`} type="button" onClick={() => setPreview(file)} disabled={!file.proofId && !sourceUrl(file)} aria-label={`View ${file.name || file.originalName || 'supporting document'}`}><Eye size={14} />{file.name || file.originalName || `Document ${index + 1}`}</button>) : <span className="ar-muted">No supporting documents</span>}</div>
    {preview && (isEmailProof(preview) ? createPortal(<OutlookMsgViewer file={preview} onClose={() => setPreview(null)} />, document.body) : <ArReviewDialog title={preview.name || 'Document preview'} onClose={() => setPreview(null)}><div className="ar-document-actions"><a href={sourceUrl(preview)} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />Open</a><a href={sourceUrl(preview)} download={preview.name}><Download size={15} />Download</a></div>{/^image\//i.test(preview.type || preview.mimeType || '') || /\.(png|jpe?g|gif|webp)$/i.test(preview.name || '') ? <img className="ar-proof-image" src={sourceUrl(preview)} alt={preview.name || 'Supporting document'} /> : /\.pdf$/i.test(preview.name || '') || preview.type === 'application/pdf' ? <iframe className="ar-proof-frame" src={sourceUrl(preview)} title={preview.name || 'PDF proof'} /> : <p className="ar-muted">Select Open or Download to view this file.</p>}</ArReviewDialog>)}
  </>;
}
