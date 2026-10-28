import { jsPDF } from 'jspdf'
export const invoiceFields = [
 ['deliveryNote','Delivery Note'], ['paymentTerms','Mode / Terms of Payment','50% ADVANCE'], ['reference','Reference No. & Date'], ['otherReferences','Other References','AS PER PO'], ['buyerOrder','Buyer’s Order No.'], ['buyerOrderDate','Buyer’s Order Date'], ['dispatchDocument','Dispatch Doc No.'], ['deliveryDate','Delivery Note Date'], ['dispatchedThrough','Dispatched Through'], ['destination','Destination'], ['deliveryTerms','Terms of Delivery'], ['consignee','Consignee (Ship To) Name'], ['consigneeAddress','Consignee Address'], ['consigneeGst','Consignee GSTIN / UIN'], ['consigneeState','Consignee State & Code'], ['buyerStateCode','Buyer State Code'], ['hsn','HSN / SAC','998311'], ['bankName','Bank Name'], ['accountName','Account Name','Ananttattva Private Limited'], ['accountNumber','Account Number'], ['ifsc','IFSC Code'], ['pan','Company PAN'], ['declaration','Declaration','We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.']
]
const small = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen']
function words(n) { n = Math.floor(n); if (!n) return 'Zero'; if(n<20)return small[n]; if(n<100)return ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'][Math.floor(n/10)]+(n%10?' '+words(n%10):''); for(const [v,t] of [[10000000,'Crore'],[100000,'Lakh'],[1000,'Thousand'],[100,'Hundred']])if(n>=v)return words(n/v)+' '+t+(n%v?' '+words(n%v):''); return '' }
const currencyWords = n => words(n)+(Math.round((n%1)*100)?' and '+words(Math.round((n%1)*100))+' Paise':'')+' Only'
export function buildInvoicePdf(row) {
 const pdf = new jsPDF({unit:'pt',format:'a4'})
 const d = {...Object.fromEntries(invoiceFields.map(([k,,v])=>[k,v||''])),...(row.invoiceDetails||{})}, lead=row.leadDetails||{}
 const cash = n => Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})
 const date = v => v ? new Date(v).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'2-digit'}) : ''
 function text(v,x,y,w=530,bold=false,size=8) {pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);const lines=pdf.splitTextToSize(String(v||''),w);pdf.text(lines,x,y);return lines.length*size*1.15}
 function box(x,y,w,h){pdf.setDrawColor(125);pdf.setLineWidth(.35);pdf.rect(x,y,w,h)}
 function cell(label,value,x,y,w,h){box(x,y,w,h);text(label,x+3,y+9,w-6,false,7);text(value,x+3,y+20,w-6,true,8)}
 function header(){text('PROFORMA INVOICE',297,20,260,true,11);box(26,26,543,247)
 text('ANANTTATTVA PRIVATE LIMITED',29,37,309,true,9)
 text('Office No. 14, Midas Building,\nSahar Plaza, J B Nagar, Andheri (East)\nMumbai - 400059\nUDYAM : UDYAM-MH-19-0252978 (Micro/Services)\nGSTIN/UIN: 27AAZCA6657R1ZB\nState Name: Maharashtra, Code: 27\nCIN: U39000MH2023PTC413566\nE-Mail: info@ananttattva.com',29,48,309,false,8)
 cell('Consignee (Ship To)',[d.consignee||lead.companyName,d.consigneeAddress||[lead.addressLine1,lead.addressLine2,lead.addressLine3,lead.city,lead.pinCode].filter(Boolean).join(', '),'GSTIN/UIN: '+(d.consigneeGst||lead.gstNumber||''),'State: '+(d.consigneeState||lead.state||'')].join('\n'),26,136,316,68)
 cell('Buyer (Bill To)',[lead.companyName||row.companyName,[lead.addressLine1,lead.addressLine2,lead.addressLine3,lead.city,lead.pinCode].filter(Boolean).join(', '),'GSTIN/UIN: '+(lead.gstNumber||''),'State: '+(lead.state||'')+'  Code: '+d.buyerStateCode].join('\n'),26,204,316,69)
 const pairs=[['Invoice No.',row.proformaNumber,'Dated',date(row.invoiceDate)],['Delivery Note',d.deliveryNote,'Mode/Terms of Payment',d.paymentTerms],['Reference No. & Date',d.reference||row.quotationNumber,'Other References',d.otherReferences],['Buyer’s Order No.',d.buyerOrder||row.poNumber,'Dated',date(d.buyerOrderDate)],['Dispatch Doc No.',d.dispatchDocument,'Delivery Note Date',date(d.deliveryDate)],['Dispatched Through',d.dispatchedThrough,'Destination',d.destination]]
 pairs.forEach(([a,b,c,e],i)=>{cell(a,b,342,26+i*31,113,31);cell(c,e,455,26+i*31,114,31)})
 cell('Terms of Delivery',d.deliveryTerms,342,212,227,61)
 }
 header()
 const xs=[26,41,350,397,440,485,505,569], labels=['Sl\nNo.','Description of\nServices','HSN/SAC','Quantity','Rate','per','Amount']
 let y=273
 function table(){labels.forEach((v,i)=>{box(xs[i],y,xs[i+1]-xs[i],23);text(v,xs[i]+3,y+9,xs[i+1]-xs[i]-6,false,7)});y+=23}
 table()
 const items=row.items||[], base=row.pricingMode==='combined'?Number(row.combinedBasicAmount||row.subtotal||0):items.reduce((s,i)=>s+(Number(i.unit)||1)*Number(i.basicAmount||0),0), tax=Math.round(base*18)/100
 items.forEach((item,i)=>{
 const description=[item.serviceCategory||item.piboCategory||'Service',item.servicesOffered,item.servicesForYear, ...(item.annualReturnYears||[]).map(v=>'Annual Return: '+v)].filter(Boolean).join('\n')
 pdf.setFontSize(8);const h=Math.max(40,pdf.splitTextToSize(description,300).length*10+12)
 if(y+h>535){pdf.addPage();header();y=273;table()}
 const combined=row.pricingMode==='combined', rate=combined?base:Number(item.basicAmount||0), qty=Number(item.unit)||1
 const values=[i+1,description,d.hsn,combined?'':qty,combined?'':cash(rate),'',combined?(i===0?cash(base):''):cash(rate*qty)]
 values.forEach((v,c)=>{box(xs[c],y,xs[c+1]-xs[c],h);text(v,xs[c]+3,y+12,xs[c+1]-xs[c]-6,c===1||c===6,8)})
 y+=h
 })
 const bottom=Math.max(548,y+45)
 xs.slice(0,-1).forEach((x,i)=>box(x,y,xs[i+1]-x,bottom-y))
 text('IGST OUTPUT 18%',220,y+25,125,true);text('18 %',448,y+25,50);text(cash(tax),508,y+25,58,true)
 y=bottom;cell('Total','INR '+cash(base+tax),26,y,543,26);y+=26
 text('Amount Chargeable (in words)',29,y+9,450,false,7);text('INR '+currencyWords(base+tax),29,y+21,530,true,8);y+=29
 const taxRows=[['HSN/SAC','Taxable Value','IGST Rate','Tax Amount','Total Tax'],[d.hsn,cash(base),'18%',cash(tax),cash(tax)]]
 taxRows.forEach(values=>{const widths=[280,80,50,65,68];let x=26;values.forEach((v,i)=>{box(x,y,widths[i],16);text(v,x+3,y+11,widths[i]-6,false,7);x+=widths[i]});y+=16})
 text('Tax Amount (in words): INR '+currencyWords(tax),29,y+12,530,true,8);y+=20
 const bank=[d.bankName&&'Bank Name: '+d.bankName,d.accountName&&'Account Name: '+d.accountName,d.accountNumber&&'Account No.: '+d.accountNumber,d.ifsc&&'IFSC Code: '+d.ifsc,d.pan&&'Company PAN: '+d.pan].filter(Boolean).join('\n')
 y+=text(bank,29,y+8,300,false,7)+10
 const dh=text('Declaration\n'+d.declaration,29,y,300,false,7)
 box(340,y-8,229,Math.max(34,dh));text('for ANANTTATTVA PRIVATE LIMITED',346,y+2,218,true,7);text('Authorised Signatory',458,y+24,105,false,7)
 text('SUBJECT TO MUMBAI JURISDICTION',190,818,350,false,7);text('This is a Computer Generated Invoice',190,829,350,false,7)
 const extra=[...(row.terms||[]).filter(Boolean).map(v=>'Terms: '+v),...(row.scopeOfWork||[]).filter(Boolean).map(v=>'Scope: '+v)]
 if(extra.length){pdf.addPage();let ey=38;text('PROFORMA INVOICE - '+row.proformaNumber,26,ey,540,true,11);ey+=25;extra.forEach(v=>{const lines=pdf.splitTextToSize(v,530);lines.forEach(line=>{if(ey>795){pdf.addPage();ey=38}text(line,29,ey,530);ey+=12});ey+=6})}
 return pdf
}

