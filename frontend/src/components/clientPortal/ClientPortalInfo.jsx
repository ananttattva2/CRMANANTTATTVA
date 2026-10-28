import React, { useState } from 'react';
import { Building2, FileText, Mail, Phone, MapPin, Users } from 'lucide-react';
import { collectDetails, companyDocuments, fieldLabel, handlingTeam, hasValue, uniqueRows } from '../../utils/clientPortalPresentation.mjs';
export function InfoGrid({
  rows
}) {
  return <dl className="cp-info-grid">{rows.filter(row => hasValue(row.value)).map((row, index) => <div key={index}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>;
}
export function ComplianceFields({
  fields,
  Table
}) {
  const repeated = new Map();
  for (const field of fields) {
    const match = field.group.match(/^(.*) \/ (\d+)$/);
    if (!match) continue;
    const group = repeated.get(match[1]) || new Map();
    const row = group.get(match[2]) || {};
    row[field.label] = field.value;
    group.set(match[2], row);
    repeated.set(match[1], group);
  }
  const tables = [...repeated.entries()].filter(([name, rows]) => rows.size > 1 || /Products|Production/.test(name));
  const tableNames = new Set(tables.map(([name]) => name));
  const scalar = fields.filter(field => !tableNames.has(field.group.replace(/ \/ \d+$/, '')));
  return <div className="cp-stack"><InfoGrid rows={scalar.map(field => ({
      label: field.group ? `${field.group} / ${field.label}` : field.label,
      value: field.value
    }))} />{tables.map(([name, records]) => {
      const rows = [...records.values()];
      const keys = [...new Set(rows.flatMap(Object.keys))];
      return <div key={name}><h4 className="cp-subtitle">{name}</h4><Table columns={keys.map(key => ({
          label: key,
          key
        }))} rows={rows} /></div>;
    })}</div>;
}
export default function ClientPortalInfo({
  client,
  initialTab = 'overview',
  onViewFile,
  Table,
  Section
}) {
  const [tab, setTab] = useState(['overview', 'contacts', 'services', 'compliance', 'documents'].includes(initialTab) ? initialTab : 'overview');
  const masters = client.clientMaster || [],
    docs = companyDocuments(client);
  const contacts = uniqueRows(client.contacts || [], row => `${row.plantUnit}|${row.emails || row.email}|${row.contactPerson}`);
  const masterLocations = masters.flatMap(master => ['registeredAddress', 'communicationAddress'].filter(key => master[key]).map(key => ({
    unitName: fieldLabel(key),
    ...Object.fromEntries(Object.entries(master[key]).map(([key, value]) => [{
      address1: 'addressLine1',
      address2: 'addressLine2',
      address3: 'addressLine3',
      pincode: 'pinCode'
    }[key] || key, value]))
  })));
  const locations = uniqueRows([...(client.addresses || []), ...masterLocations].filter(row => row.addressLine1 || row.city), row => [row.addressLine1, row.addressLine2, row.addressLine3, row.city, row.state, row.pinCode].join('|').toLowerCase().replace(/[,\s]+/g, ' '));
  const primary = masters.find(master => master.compliance?.gstNumber || master.compliance?.gst) || masters[0] || {};
  const basic = primary.basic || {},
    compliance = primary.compliance || {};
  const tabs = [['overview', 'Company overview', Building2], ['contacts', 'Contacts & locations', MapPin], ['services', 'Services & SPOC', Users], ['compliance', 'Registration & compliance', FileText], ['documents', `Documents (${docs.length})`, FileText]];
  return <div className="cp-company"><div className="cp-company-heading"><span className="cp-company-icon"><Building2 /></span><div><h2>{client.company}</h2><p>{client.leadCode} <span>•</span> {[client.city, client.state].filter(Boolean).join(', ')}</p></div><span className="cp-badge">Client account</span></div><nav className="cp-detail-tabs" aria-label={`${client.company} information`}>{tabs.map(([key, title, Icon]) => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)} className={tab === key ? 'active' : ''}><Icon size={15} />{title}</button>)}</nav>
  {tab === 'overview' && <div className="cp-two-columns"><Section title="Company details" description="Your business profile and identifiers."><InfoGrid rows={[['Legal name', basic.clientLegalName || client.company], ['Trade name', basic.tradeName], ['Industry', client.industryType || basic.companyIndustry], ['Company type', basic.companyType], ['Lead code', client.leadCode], ['GST Number', compliance.gstNumber || compliance.gst], ['CIN', compliance.cinNumber || compliance.cin], ['PAN', compliance.panNumber || compliance.pan], ['Website', client.website || basic.website]].map(([label, value]) => ({
          label,
          value
        }))} /></Section><div className="cp-profile-side"><Section title="Registered address"><div className="cp-address"><MapPin size={22} /><div><p>{[client.addressLine1, client.addressLine2, client.addressLine3].filter(Boolean).join(' ').replace(/,\s*,/g, ',')}</p><strong>{[client.city, client.state, client.pinCode].filter(Boolean).join(' · ')}</strong></div></div></Section><Section title="Primary contact"><div className="cp-primary-name"><span className="cp-avatar">{(contacts[0]?.contactPerson || 'Client').split(' ').map(word => word[0]).slice(0, 2).join('')}</span><strong>{contacts[0]?.contactPerson || 'Not provided'}</strong>{contacts[0]?.designation && <span className="cp-badge">{contacts[0].designation}</span>}</div>{(contacts[0]?.emails || contacts[0]?.email) && <div className="cp-contact-line"><Mail size={21} /><a href={`mailto:${contacts[0].emails || contacts[0].email}`}>{contacts[0].emails || contacts[0].email}</a></div>}{contacts[0]?.mobileNo1 && <div className="cp-contact-line"><Phone size={21} /><a href={`tel:${contacts[0].mobileNo1}`}>{contacts[0].mobileNo1}</a></div>}</Section></div></div>}
  {tab === 'contacts' && <div className="cp-stack"><Section title="Company contacts" description="Contact people for each unit."><Table columns={[{
          label: 'Contact',
          render: row => <div className="cp-cell-main">{row.contactPerson}<small>{row.designation}</small></div>
        }, {
          label: 'Unit',
          key: 'plantUnit'
        }, {
          label: 'Email',
          render: row => <a href={`mailto:${row.emails || row.email}`}>{row.emails || row.email}</a>
        }, {
          label: 'Mobile',
          key: 'mobileNo1'
        }, {
          label: 'Alternate mobile',
          key: 'mobileNo2'
        }, {
          label: 'WhatsApp',
          key: 'whatsappNo'
        }]} rows={contacts} /></Section><Section title="Locations"><Table columns={[{
          label: 'Unit',
          render: row => row.unitName || row.plantUnit || row.unit || 'Registered office'
        }, {
          label: 'Address',
          render: row => [row.addressLine1, row.addressLine2, row.addressLine3].filter(Boolean).join(' ').replace(/,\s*,/g, ',')
        }, {
          label: 'City',
          key: 'city'
        }, {
          label: 'State',
          key: 'state'
        }, {
          label: 'PIN',
          key: 'pinCode'
        }, {
          label: 'GST',
          key: 'gstNumber'
        }]} rows={locations} /></Section></div>}
  {tab === 'services' && <div className="cp-stack"><Section title="Your services" description="Each applicant category is listed separately."><Table columns={[{
          label: 'Service',
          render: row => <strong>{row.serviceCategory || row.eprCategory}</strong>
        }, {
          label: 'Work',
          key: 'servicesOffered'
        }, {
          label: 'Applicant type',
          key: 'applicantType'
        }, {
          label: 'Category',
          key: 'subApplicantType'
        }, {
          label: 'Unit',
          key: 'plantUnit'
        }]} rows={client.services || []} /></Section><Section title="Your account team" description="Who handles your account and their assigned services."><div className="cp-team-grid">{handlingTeam(client).map((person, index) => <article className="cp-person" key={index}><span className="cp-avatar">{(person.name || 'AT').split(' ').map(word => word[0]).slice(0, 2).join('')}</span><div><h3>{person.name || 'Not assigned'}{person.contactNumber && <a className="cp-phone" href={`tel:${person.contactNumber.replace(/[^+0-9]/g, '')}`}>{person.contactNumber}</a>}</h3>{person.email && <a href={`mailto:${person.email}`}><Mail size={13} />{person.email}</a>}<div className="cp-tag-list">{person.services.map(service => <span key={service}>{service}</span>)}</div></div></article>)}</div></Section></div>}
  {tab === 'compliance' && <div className="cp-stack">{masters.map((master, index) => {
        const sections = Object.entries(master).filter(([key]) => !['id', 'registeredAddress', 'communicationAddress'].includes(key)).map(([key, value]) => ({
          key,
          ...collectDetails(value)
        })).filter(section => section.fields.length || section.documents.length);
        return <details className="cp-registration" key={master.id || index} open={index === 0}><summary><span><strong>{master.basic?.piboCategory || master.basic?.subApplicantType || `Service profile ${index + 1}`}</strong><small>{[master.basic?.eprCategory, master.basic?.servicesOffered].filter(Boolean).join(' · ') || 'Company registration details'}</small></span><span className="cp-badge">{master.cpcb?.status || 'View details'}</span></summary><div className="cp-registration-body">{sections.map(section => <section key={section.key}><h3 className="cp-subtitle">{fieldLabel(section.key)}</h3><ComplianceFields fields={section.fields} Table={Table} />{section.documents.length > 0 && <div className="cp-tag-list">{section.documents.map((doc, index) => <button className="cp-document-link" key={index} onClick={() => onViewFile?.(doc)}><FileText size={14} />{doc.category || doc.name}</button>)}</div>}</section>)}</div></details>;
      })}{!masters.length && <Section title="Registration & compliance"><p className="cp-muted">No registration records have been added yet.</p></Section>}</div>}
  {tab === 'documents' && <Section title="Company documents" description="Open certificates and uploaded documents without technical file metadata."><Table columns={[{
        label: 'Document',
        render: row => <div className="cp-cell-main"><FileText size={16} /><strong>{row.name}</strong></div>
      }, {
        label: 'Category',
        key: 'category'
      }, {
        label: 'Uploaded',
        render: row => row.uploadedAt ? new Date(row.uploadedAt).toLocaleDateString('en-IN') : '—'
      }, {
        label: 'Action',
        render: row => <button className="cp-action" onClick={() => onViewFile?.(row)}>View document</button>
      }]} rows={docs} empty="No company documents have been uploaded yet." /></Section>}
  </div>;
}
