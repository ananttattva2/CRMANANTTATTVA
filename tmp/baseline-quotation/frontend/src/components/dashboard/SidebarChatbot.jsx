import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bot, BrainCircuit, CalendarDays, Maximize2, MessageCircle, Minimize2, Send, Sparkles, X, Zap } from 'lucide-react'
import { getAssignedName, getClientUniqueId, getVisibilityStatus, isFilled, normalizeClientIdentity, readClientData } from '../../features/clientMaster/clientMaster.utils'
import { findPiboOperationsAnswer } from './piboOperationsFaq'

const starterMessages = [
  {
    id: 'welcome',
    role: 'bot',
    text: 'Hi, I am your CRM assistant. Ask me about CRM workflows or PIBO Operations—including procurement, bulk uploads, invoice validation, sales, road construction, wallet and common portal errors.',
    source: 'CRM Guide'
  }
]

const quickPrompts = [
  { label: 'PIBO Operations', prompt: 'How is the PIBO Operations module accessed?' },
  { label: 'Bulk Upload', prompt: 'How do I complete a procurement bulk upload?' },
  { label: 'Follow-ups', prompt: 'What are Follow-ups used for?' },
  { label: 'Approval', prompt: 'Explain Pending Approval' },
  { label: 'Calendar', prompt: 'How does Calendar work?' },
  { label: 'Clients', prompt: 'What is Client Master?' },
  { label: 'Quotation', prompt: 'How do I use Add Quotation?' }
]

const clientMasterSuggestions = [
  { label: 'Full Map', prompt: 'Client Master all tabs end to end' },
  { label: 'Client Basic Info', prompt: 'Explain Client Basic Info in Client Master' },
  { label: 'Address Details', prompt: 'Explain Address Details in Client Master' },
  { label: 'Compliance & MSME', prompt: 'Explain Compliance and MSME in Client Master' },
  { label: 'CTE / CTO / CCA', prompt: 'Explain CTE CTO CCA in Client Master' },
  { label: 'CPCB Details', prompt: 'Explain CPCB Details in Client Master' },
  { label: 'Validation Docs', prompt: 'Explain Validation Documents in Client Master' },
  { label: 'OTP & People', prompt: 'Explain OTP and People in Client Master' },
  { label: 'Company History', prompt: 'Explain Company History tab in Client Master' },
  { label: 'Quotation History', prompt: 'Explain Quotation History in Client Master' },
  { label: 'Annual Return', prompt: 'Explain Annual Return History in Client Master' },
  { label: 'Ticket', prompt: 'Explain Ticket tab in Client Master' },
  { label: 'Follow-Up / To-Do', prompt: 'Explain Client Interactions Follow-Up and To-Do' },
  { label: 'Annual Financials', prompt: 'Explain Annual Return Financials' },
  { label: 'Annual Data', prompt: 'Explain Annual Return Data Part A Part B Part C Part D' },
  { label: 'CPCB Letter', prompt: 'Explain Annual Return CPCB Letter' }
]

const moduleGuides = {
  dashboard: {
    match: (path) => path === '/dashboard' || path === '/dashboard/users',
    title: 'Dashboard',
    text: 'You are on Dashboard. Which dashboard area should I explain?',
    suggestions: [
      { label: 'Full Dashboard', prompt: 'Explain Dashboard full map' },
      { label: 'Operations View', prompt: 'Explain Operations Dashboard' },
      { label: 'Sales View', prompt: 'Explain Sales Dashboard' },
      { label: 'KPI Cards', prompt: 'Explain Dashboard KPI cards' },
      { label: 'Follow-ups', prompt: 'Explain Dashboard Follow-ups' },
      { label: 'User Management', prompt: 'Explain User Management' }
    ]
  },
  pendingApproval: {
    match: (path) => path.includes('/pending-approval'),
    title: 'Pending Approval',
    text: 'You are on Pending Approval. Which approval part should I explain?',
    suggestions: [
      { label: 'Full Flow', prompt: 'Explain Pending Approval full flow' },
      { label: 'Approve', prompt: 'Explain approve action in Pending Approval' },
      { label: 'Reject', prompt: 'Explain reject action in Pending Approval' },
      { label: 'Bulk Approval', prompt: 'Explain bulk approval in Pending Approval' },
      { label: 'Remarks', prompt: 'Explain approval remarks' }
    ]
  },
  notifications: {
    match: (path) => path.includes('/notifications'),
    title: 'Notifications',
    text: 'You are on Notifications. Which notification feature should I explain?',
    suggestions: [
      { label: 'Full Page', prompt: 'Explain Notifications full page' },
      { label: 'Create', prompt: 'Explain create notification' },
      { label: 'Tags', prompt: 'Explain notification tags' },
      { label: 'Attachments', prompt: 'Explain notification attachments' },
      { label: 'View / Edit', prompt: 'Explain notification view edit delete' }
    ]
  },
  calendar: {
    match: (path) => path.includes('/calendar'),
    title: 'Calendar',
    text: 'You are on Calendar. Which calendar part should I explain?',
    suggestions: [
      { label: 'Full Calendar', prompt: 'Explain Calendar full map' },
      { label: 'Agenda', prompt: 'Explain Calendar Agenda tab' },
      { label: 'Follow-ups', prompt: 'Explain Calendar Follow-ups tab' },
      { label: 'Todos', prompt: 'Explain Calendar Todos tab' },
      { label: 'History', prompt: 'Explain Calendar History tab' },
      { label: 'Complete Todo', prompt: 'Explain mark todo complete' }
    ]
  },
  leadGeneration: {
    match: (path) => path.includes('/sales/lead-generation'),
    title: 'Lead Generation',
    text: 'You are on Lead Generation. Which lead area should I explain?',
    suggestions: [
      { label: 'Full Flow', prompt: 'Explain Lead Generation full flow' },
      { label: 'Create Lead', prompt: 'Explain create lead' },
      { label: 'Lead Status', prompt: 'Explain lead status' },
      { label: 'Convert Lead', prompt: 'Explain convert lead to Client Master' },
      { label: 'Sales Owner', prompt: 'Explain lead owner assignment' }
    ]
  },
  clientMaster: {
    match: (path) => path.includes('/sales/client-master'),
    title: 'Client Master',
    text: 'You are on Client Master. Which part should I explain?',
    suggestions: clientMasterSuggestions
  },
  quotations: {
    match: (path) => path.includes('/sales/quotations'),
    title: 'Add Quotation',
    text: 'You are on Quotations. Which quotation part should I explain?',
    suggestions: [
      { label: 'Full Flow', prompt: 'Explain Add Quotation full flow' },
      { label: 'Client Context', prompt: 'Explain quotation client context' },
      { label: 'Items', prompt: 'Explain quotation items' },
      { label: 'Value / Tax', prompt: 'Explain quotation value tax' },
      { label: 'Approval', prompt: 'Explain quotation approval flow' }
    ]
  }
}

const guideKnowledge = [
  {
    keywords: ['dashboard full map', 'operations dashboard', 'dashboard kpi', 'dashboard follow-ups', 'sales dashboard'],
    title: 'Dashboard Guide',
    answer:
      'Dashboard is the CRM control room.\n\nOperations Dashboard focuses on approvals, client movement, pending work, operational counts, and follow-ups.\n\nSales Dashboard focuses on lead performance, converted clients, quotation value, today leads, and calendar-linked follow-ups.\n\nKPI cards give quick numbers. Follow-up panels show user-specific upcoming client actions. Admin users can switch dashboard modes when allowed.'
  },
  {
    keywords: ['pending approval full flow', 'approve action', 'reject action', 'bulk approval', 'approval remarks'],
    title: 'Pending Approval Guide',
    answer:
      'Pending Approval is the review desk.\n\nUse Approve when a quotation or client submission is correct and can move ahead. Use Reject when details need correction. Remarks explain the decision and become part of the workflow history.\n\nBulk approval is useful when multiple selected records are already checked. This page protects sensitive business actions before they become final.'
  },
  {
    keywords: ['notifications full page', 'create notification', 'notification tags', 'notification attachments', 'notification view edit delete'],
    title: 'Notifications Guide',
    answer:
      'Notifications manages internal announcements and shared material.\n\nCreate Notification adds title, description, tag, status, and optional attachment. Tags classify items like Training Material, SOP, Company Profile, or compliance references. Attachments can be viewed or downloaded. View opens details, Edit updates content, Delete removes obsolete announcements.'
  },
  {
    keywords: ['calendar full map', 'calendar agenda', 'calendar follow-ups', 'calendar todos', 'calendar history', 'mark todo complete'],
    title: 'Calendar Guide',
    answer:
      'Calendar manages time-based work.\n\nAgenda shows the selected date summary. Follow-ups are client touchpoints and reminders. Todos are assigned tasks that can be completed with remarks. History keeps completed or past activity context. Month, week, and day views help users scan workload, overdue items, and upcoming work.'
  },
  {
    keywords: ['lead generation full flow', 'create lead', 'lead status', 'convert lead', 'lead owner'],
    title: 'Lead Generation Guide',
    answer:
      'Lead Generation captures new prospects.\n\nCreate Lead stores company and contact details. Lead status tracks progress. Owner assignment shows who is responsible. When a lead becomes qualified or active, it can move into Client Master, where compliance, quotations, documents, follow-ups, and annual return work continue.'
  },
  {
    keywords: ['add quotation full flow', 'quotation client context', 'quotation items', 'quotation value tax', 'quotation approval flow'],
    title: 'Add Quotation Guide',
    answer:
      'Add Quotation creates commercial proposals.\n\nClient context links the quote to a lead or client. Items describe services, scope, quantity, rates, value, and tax. After saving, the quotation can be sent to Pending Approval. Approved quotations then support Client Master history, financials, PO tracking, and annual return references.'
  }
]

const crmKnowledge = [
  {
    keywords: ['follow', 'follow-up', 'followups', 'touchpoint', 'reminder'],
    title: 'Follow-ups',
    answer:
      'Follow-ups help users track client touchpoints after a lead or client needs attention. In this CRM, follow-ups can come from the Calendar and are shown on the Dashboard according to the logged-in user. Use them to remember call-backs, client reminders, overdue actions, and next contact dates.'
  },
  {
    keywords: ['dashboard', 'home', 'summary', 'kpi', 'analytics'],
    title: 'Dashboard',
    answer:
      'The Dashboard gives a fast overview of CRM activity. It shows important counts, pending work, follow-ups, lead movement, quotation value, and operational status. Admin users can switch between Operations Dashboard and Sales Dashboard where available.'
  },
  {
    keywords: ['pending approval', 'approval', 'approve', 'reject', 'pending'],
    title: 'Pending Approval',
    answer:
      'Pending Approval is used to review records that need a manager or admin decision. Quotations and client-related submissions can be approved or rejected from this page. It helps keep sensitive sales and compliance actions controlled before they move forward.'
  },
  {
    keywords: ['notification', 'announcement', 'notice', 'training', 'material'],
    title: 'Notifications',
    answer:
      'Notifications are used for internal announcements, documents, training material, SOPs, and updates. Users can view details, download attachments, and keep important team communication in one organized place.'
  },
  {
    keywords: ['calendar', 'todo', 'task', 'agenda', 'schedule', 'overdue', 'date'],
    title: 'Calendar',
    answer:
      'Calendar manages follow-ups and todos by date. Users can create scheduled activities, mark todos complete with remarks, view overdue work, and check daily agenda history. Dashboard follow-ups are connected to this calendar data.'
  },
  {
    keywords: ['sales dashboard', 'sales', 'pipeline', 'converted', 'value'],
    title: 'Sales',
    answer:
      'Sales covers lead capture, client conversion, quotations, and sales performance. The Sales Dashboard helps users see leads, converted clients, quotation value, and upcoming follow-ups linked to sales work.'
  },
  {
    keywords: ['lead generation', 'lead', 'prospect', 'new lead'],
    title: 'Lead Generation',
    answer:
      'Lead Generation is where new prospects are entered and tracked. It helps the sales team capture company details, lead status, owner information, and move qualified leads toward Client Master when they become active clients.'
  },
  {
    keywords: ['client master', 'client', 'company', 'customer', 'compliance', 'annual return'],
    title: 'Client Master',
    answer:
      'Client Master is the main client database. It stores company profile, compliance information, quotation links, documents, processing fields, follow-ups, todos, and annual return related details in one place.\n\nMain client form tabs: Client Basic Info, Address Details, Compliance & MSME, CTE / CTO / CCA, CPCB Details, Validation Documents, and OTP & People.\n\nClient detail tabs: Basic Info, Company History, Quotation History, Annual Return History, and Ticket.'
  },
  {
    keywords: ['quotation', 'quote', 'add quotation', 'proposal', 'amount', 'po'],
    title: 'Add Quotation',
    answer:
      'Add Quotation is used to create a new quotation for a lead or client. After saving, a quotation can move to Pending Approval so the team can review pricing and details before final approval.'
  },
  {
    keywords: ['user management', 'user', 'role', 'team', 'admin', 'manager'],
    title: 'User Management',
    answer:
      'User Management is for admins and managers to manage CRM users, roles, teams, reporting structure, and access. It helps route work to the right people and keeps dashboards user-specific.'
  }
]

const clientMasterKnowledge = [
  {
    keywords: ['client basic info', 'basic info', 'basic tab', 'legal name', 'trade name', 'pibo', 'epr'],
    title: 'Client Master - Basic Info',
    answer:
      'Basic Info contains the client identity and core classification. It covers organisation legal name, trade name, PIBO category, EPR category, onboarding year, first annual return year, visibility status, assigned user, CPCB status, and important client identifiers. In the detail popup, Basic Info also opens accordions for profile data, addresses, document depository, and contact matrix.'
  },
  {
    keywords: ['address details', 'address tab', 'registered address', 'communication address', 'city', 'state', 'pin'],
    title: 'Client Master - Address Details',
    answer:
      'Address Details stores the registered address and communication address. It is used for official records, state/city filtering, CPCB or compliance filing references, and annual return client data. Registered and communication address data can also appear in the Client Details popup under the address accordion.'
  },
  {
    keywords: ['compliance', 'msme', 'gst', 'cin', 'pan', 'factory license', 'epr certificate', 'iec', 'udyam'],
    title: 'Client Master - Compliance & MSME',
    answer:
      'Compliance & MSME keeps statutory identifiers and documents. It includes GST, CIN, PAN, Factory License, EPR Certificate, IEC, DIC/DCSSI, document dates, uploaded files, and MSME/Udyam information. This data supports document checks, annual return preparation, and compliance review.'
  },
  {
    keywords: ['cte', 'cto', 'cca', 'consent', 'water consent', 'air consent', 'spcb', 'pcc'],
    title: 'Client Master - CTE / CTO / CCA',
    answer:
      'CTE / CTO / CCA stores pollution control consent information. It is used for water and air consent application numbers, validity dates, consent documents, and state-level compliance records. Annual Return Data Part B uses these fields for consent details.'
  },
  {
    keywords: ['cpcb details', 'cpcb login', 'cpcb status', 'registration number', 'cepr', 'portal'],
    title: 'Client Master - CPCB Details',
    answer:
      'CPCB Details manages CPCB portal information such as login ID, password, application or registration status, registration number, issue date, validity, and portal references. This helps the team track CPCB work and supports annual filing data.'
  },
  {
    keywords: ['validation documents', 'validation', 'document validation', 'quotation document', 'sla document', 'upload document'],
    title: 'Client Master - Validation Documents',
    answer:
      'Validation Documents holds supporting files and checked documents used before processing client work. It can include quotation document references, SLA documents, compliance files, and uploaded proof needed to validate the client record.'
  },
  {
    keywords: ['otp', 'people', 'contact', 'authorised person', 'coordinating person', 'mobile', 'email'],
    title: 'Client Master - OTP & People',
    answer:
      'OTP & People stores authorised person and coordinating person details. It includes names, designations, OTP-enabled mobile number, contact mobile, email, and people responsible for communication. These details are used in filings and client coordination.'
  },
  {
    keywords: ['company history', 'history tab', 'company timeline', 'company entries'],
    title: 'Client Detail - Company History',
    answer:
      'Company History is the place for timeline-style client changes and historical company activity. In the current UI, it can show an empty state when no company history is mapped yet.'
  },
  {
    keywords: ['quotation history', 'quote history', 'quotation ledger', 'latest quote', 'quote value'],
    title: 'Client Detail - Quotation History',
    answer:
      'Quotation History shows the client quotation ledger. It summarizes company name, total quotations, total quote value, latest quote, quotation cards, quotation items, and actions to create, preview, open, or revise quotations. It connects Client Master with the Add Quotation flow.'
  },
  {
    keywords: ['annual return history', 'annual history', 'annual return tab', 'annual return hubs', 'annual year', 'filing'],
    title: 'Client Detail - Annual Return History',
    answer:
      'Annual Return History shows annual return hubs by financial year. After selecting a year, the screen opens annual return processing. This includes Basic Info, Financials, Data, and CPCB Letter tabs. It tracks draft progress, completed steps, submission to Manager, Manager review, Compliance review, approval, rejection, and final completion.'
  },
  {
    keywords: ['ticket', 'tickets', 'raise ticket', 'support ticket'],
    title: 'Client Detail - Ticket',
    answer:
      'Ticket is the client journey tracker. It records Lead Closure, PO Received, and Kick-off Meeting dates with Yes/No completion, remarks, MOM points, and proof files. The separate Work Follow-ups table supports multiple dated action rows with Pending, In Progress, or Done status.'
  },
  {
    keywords: ['client interaction', 'interactions', 'client follow-up', 'client todo', 'to-do', 'todo'],
    title: 'Client Interactions',
    answer:
      'Client Interactions has two tabs: Follow-Up and To-Do. Follow-Up is used for dated client touchpoints like calls, reminders, and next contact. To-Do is used for internal tasks assigned to the team. Items saved here are stored with the client and also connect to the Calendar data.'
  },
  {
    keywords: ['annual basic', 'annual basic info', 'annual processing basic'],
    title: 'Annual Return - Basic Info',
    answer:
      'Annual Return Basic Info gathers the filing base data. It includes client details, MSME details, CPCB login details, and contact person details. Much of it is auto-filled from Client Master so the team can verify before moving ahead.'
  },
  {
    keywords: ['annual financial', 'financials', 'quotation and sla', 'po year', 'credit details', 'amount received'],
    title: 'Annual Return - Financials',
    answer:
      'Annual Return Financials covers quotation and SLA details, compliance document payment details, financial-year-wise PO rows, amount received, received through, amount status, credit PO details, credit date, and credit amount received information.'
  },
  {
    keywords: ['annual data', 'data tab', 'part a', 'part b', 'part c', 'part d', 'raw data', 'plant declaration'],
    title: 'Annual Return - Data',
    answer:
      'Annual Return Data is the main filing workspace. It is split into Part A - Client Data, Part B - Consent Details, Part C - Raw Data & Interaction, and Part D - Plant & Declaration Details. Users complete each part, upload required files, and then submit the data for Manager review. Manager can approve/reject, then Compliance Manager can review next.'
  },
  {
    keywords: ['cpcb letter', 'letter tab', 'authority letter', 'representation letter'],
    title: 'Annual Return - CPCB Letter',
    answer:
      'CPCB Letter is used for official letter or representation content connected to CPCB or authority communication. It supports letter fields and uploaded/generated references after annual data is prepared.'
  }
]

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ')
}

function getLocalCount(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}

function readStorageArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || sessionStorage.getItem(key) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function readAllStorageArrays() {
  const arrays = []
  try {
    const stores = [localStorage, sessionStorage].filter(Boolean)
    stores.forEach((store) => {
      for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index)
        if (!key || !/(client|lead|quotation|calendar|todo|annual|ccp|crm)/i.test(key)) continue
        const parsed = JSON.parse(store.getItem(key) || 'null')
        if (Array.isArray(parsed)) arrays.push({ key, rows: parsed })
      }
    })
  } catch {
    return arrays
  }
  return arrays
}

function valueAt(source, path) {
  return String(path || '').split('.').reduce((value, key) => value?.[key], source)
}

function sectionScore(data, fields) {
  const checks = fields.map((field) => ({
    label: field.label,
    value: typeof field.value === 'function' ? field.value(data) : valueAt(data, field.path)
  }))
  const filled = checks.filter((field) => isFilled(field.value)).length
  const total = checks.length || 1
  const missing = checks.filter((field) => !isFilled(field.value)).map((field) => field.label)
  return {
    filled,
    total,
    missing,
    percent: Math.round((filled / total) * 100)
  }
}

function statusFromPercent(percent) {
  if (percent >= 90) return 'Strong'
  if (percent >= 70) return 'In progress'
  if (percent >= 45) return 'Needs update'
  return 'High gap'
}

function matchCompanyName(item, query) {
  const data = readClientData(item)
  const queryKey = normalizeClientIdentity(query)
  const names = [
    data.basic?.clientLegalName,
    data.basic?.tradeName,
    data.importMeta?.uniqueId,
    data.importMeta?.leadNumber,
    item?.companyName,
    item?.clientName,
    item?.name
  ].filter(Boolean)

  return names.some((name) => {
    const nameKey = normalizeClientIdentity(name)
    return nameKey && (nameKey.includes(queryKey) || queryKey.includes(nameKey))
  })
}

function getCachedClients() {
  const preferred = [
    ...readStorageArray('crm.ccp.clients.cache.v1'),
    ...readStorageArray('crm.clients.cache.v1')
  ]
  const discovered = readAllStorageArrays()
    .filter(({ key }) => /client/i.test(key))
    .flatMap(({ rows }) => rows)
  const seen = new Set()
  return [...preferred, ...discovered].filter((item) => {
    const data = readClientData(item)
    const key = String(item?._id || item?.id || getClientUniqueId(item) || data.basic?.clientLegalName || data.basic?.tradeName || '').toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return Boolean(data.basic?.clientLegalName || data.basic?.tradeName || item?.companyName)
  })
}

function getRelatedCalendarItems(client, data) {
  const clientKey = String(client?._id || client?.id || getClientUniqueId(client) || data.basic?.clientLegalName || '')
  const companyKey = normalizeClientIdentity(data.basic?.clientLegalName || data.basic?.tradeName)
  return readStorageArray('crm.calendar.todos.v1').filter((item) => {
    const itemClientKey = String(item.clientKey || '')
    const itemCompanyKey = normalizeClientIdentity(item.company || item.companyName || item.clientName || item.title || '')
    return (clientKey && itemClientKey === clientKey) || (companyKey && itemCompanyKey.includes(companyKey))
  })
}

function getRelatedQuotations(data) {
  const companyKey = normalizeClientIdentity(data.basic?.clientLegalName || data.basic?.tradeName)
  return readAllStorageArrays()
    .filter(({ key }) => /quotation|quote/i.test(key))
    .flatMap(({ rows }) => rows)
    .filter((item) => {
      const itemCompany = normalizeClientIdentity(item.companyName || item.leadDetails?.companyName || item.clientName || item.company || '')
      return companyKey && itemCompany && (itemCompany.includes(companyKey) || companyKey.includes(itemCompany))
    })
}

function latestAnnualWorkflow(data) {
  const filings = data.annualReturn?.filings && typeof data.annualReturn.filings === 'object' ? data.annualReturn.filings : {}
  const filingRows = Object.entries(filings).map(([year, filing]) => ({ year, filing }))
  if (!filingRows.length) return null
  return filingRows[filingRows.length - 1]
}

function buildCompanyAudit(query, liveClients = []) {
  const clients = Array.isArray(liveClients) && liveClients.length ? liveClients : getCachedClients()
  const matchedClient = clients.find((client) => matchCompanyName(client, query))
  if (!matchedClient) return null

  const data = readClientData(matchedClient)
  const calendarItems = getRelatedCalendarItems(matchedClient, data)
  const quotations = getRelatedQuotations(data)
  const followUps = calendarItems.filter((item) => item.type === 'follow-up')
  const todos = calendarItems.filter((item) => item.type !== 'follow-up')
  const completedTodos = todos.filter((item) => item.status === 'completed')
  const annualWorkflow = latestAnnualWorkflow(data)
  const annualStatus = annualWorkflow?.filing?.approvalWorkflow?.status || annualWorkflow?.filing?.status || data.annualReturn?.status || 'Not started'

  const sectionDefs = [
    {
      section: 'Basic Info',
      fields: [
        { label: 'Unique ID', value: () => getClientUniqueId(matchedClient) },
        { label: 'Legal Name', path: 'basic.clientLegalName' },
        { label: 'Trade Name', path: 'basic.tradeName' },
        { label: 'PIBO Category', path: 'basic.piboCategory' },
        { label: 'Service Category', path: 'basic.eprCategory' },
        { label: 'Assigned User', value: () => getAssignedName(matchedClient) },
        { label: 'Visibility', value: () => getVisibilityStatus(matchedClient) }
      ]
    },
    {
      section: 'Address',
      fields: [
        { label: 'Registered Address', path: 'registeredAddress.address1' },
        { label: 'Registered City', path: 'registeredAddress.city' },
        { label: 'Registered State', path: 'registeredAddress.state' },
        { label: 'Registered PIN', path: 'registeredAddress.pincode' },
        { label: 'Communication Address', path: 'communicationAddress.address1' },
        { label: 'Communication City', path: 'communicationAddress.city' }
      ]
    },
    {
      section: 'Compliance & MSME',
      fields: [
        { label: 'GST', path: 'compliance.gst' },
        { label: 'CIN', path: 'compliance.cin' },
        { label: 'PAN', path: 'compliance.pan' },
        { label: 'Factory License', path: 'compliance.factoryLicense' },
        { label: 'EPR Certificate', path: 'compliance.eprCertificate' },
        { label: 'MSME / Udyam', value: () => (Array.isArray(data.msmeRows) && data.msmeRows.length ? 'Available' : '') }
      ]
    },
    {
      section: 'CPCB',
      fields: [
        { label: 'CPCB Status', path: 'cpcb.status' },
        { label: 'Registration No.', path: 'cpcb.registrationNumber' },
        { label: 'Login ID', value: () => data.cpcb?.loginId || data.cpcb?.ceprUserId },
        { label: 'Password', value: () => data.cpcb?.loginPassword || data.cpcb?.ceprPassword },
        { label: 'Validity', path: 'cpcb.validityDate' }
      ]
    },
    {
      section: 'Contacts',
      fields: [
        { label: 'OTP Mobile', path: 'otp.mobile' },
        { label: 'OTP Person', path: 'otp.personName' },
        { label: 'Authorised Person', path: 'authorised.name' },
        { label: 'Authorised Email', path: 'authorised.email' },
        { label: 'Coordinating Person', path: 'coordinating.name' },
        { label: 'Coordinating Email', path: 'coordinating.email' }
      ]
    },
    {
      section: 'Financials / Quotation',
      fields: [
        { label: 'Quotation Records', value: () => quotations.length ? `${quotations.length}` : '' },
        { label: 'Quotation No.', path: 'financials.quotationNo' },
        { label: 'Quotation Date', path: 'financials.quotationDate' },
        { label: 'SLA No.', path: 'financials.slaNo' },
        { label: 'Amount Status', path: 'financials.amountStatus' },
        { label: 'Received Date', path: 'financials.receivedDate' }
      ]
    },
    {
      section: 'Calendar Work',
      fields: [
        { label: 'Follow-ups', value: () => followUps.length ? `${followUps.length}` : '' },
        { label: 'Todos', value: () => todos.length ? `${todos.length}` : '' },
        { label: 'Completed Todos', value: () => completedTodos.length ? `${completedTodos.length}` : '' },
        { label: 'Open Work', value: () => calendarItems.some((item) => item.status !== 'completed') ? 'Available' : '' }
      ]
    },
    {
      section: 'Annual Return',
      fields: [
        { label: 'First Annual Year', path: 'basic.firstAnnualReturnYear' },
        { label: 'Annual Filing Status', value: () => annualStatus },
        { label: 'Annual Filing Data', value: () => annualWorkflow ? annualWorkflow.year : '' },
        { label: 'Portal Data', path: 'annualReturn.portalData' }
      ]
    }
  ]

  const rows = sectionDefs.map((definition) => {
    const score = sectionScore(data, definition.fields)
    return {
      section: definition.section,
      filled: score.filled,
      missingCount: score.total - score.filled,
      percent: score.percent,
      status: statusFromPercent(score.percent),
      missing: score.missing.slice(0, 4)
    }
  })

  const overallPercent = Math.round(rows.reduce((sum, row) => sum + row.percent, 0) / (rows.length || 1))
  const criticalMissing = rows.flatMap((row) => row.missing.map((field) => `${row.section}: ${field}`)).slice(0, 8)
  const activeProcess = [
    `CPCB: ${data.cpcb?.status || 'Not updated'}`,
    `Annual Return: ${annualStatus}`,
    `Follow-ups: ${followUps.length}`,
    `Open calendar work: ${calendarItems.filter((item) => item.status !== 'completed').length}`,
    `Quotations found: ${quotations.length}`
  ]

  return {
    companyName: data.basic?.clientLegalName || data.basic?.tradeName || query,
    uniqueId: getClientUniqueId(matchedClient) || '-',
    owner: getAssignedName(matchedClient) || '-',
    visibility: getVisibilityStatus(matchedClient) || '-',
    overallPercent,
    filledFields: rows.reduce((sum, row) => sum + row.filled, 0),
    remainingFields: rows.reduce((sum, row) => sum + row.missingCount, 0),
    totalFields: rows.reduce((sum, row) => sum + row.filled + row.missingCount, 0),
    alertCount: criticalMissing.length + calendarItems.filter((item) => item.status !== 'completed').length,
    rows,
    criticalMissing,
    activeProcess
  }
}

export function buildAnswer(question, context = {}) {
  const cleanQuestion = normalize(question)
  const userName = String(context.userName || 'Krishna Yadav').trim()
  const firstName = userName.split(/\s+/)[0] || 'Krishna'
  const asksName = /^(my )?name( is)?( krishna)?$/.test(cleanQuestion)
    || cleanQuestion === 'krishna'
    || cleanQuestion.includes('what is my name')
    || cleanQuestion.includes('who am i')
  if (asksName) {
    return {
      text: `Your name is ${userName}. Nice to have you here, ${firstName}! I can also help with your CRM profile, assigned work, leads, clients and compliance workflows.`,
      source: 'Signed-in CRM profile',
      confidence: 'Personalized',
      suggestions: [
        { label: 'My profile', prompt: 'What details are in my CRM profile?' },
        { label: 'My work', prompt: 'Show me what CRM work I should check today' },
        { label: 'Client Master', prompt: 'Explain Client Master full flow' },
        { label: 'PIBO help', prompt: 'How is the PIBO Operations module accessed?' }
      ]
    }
  }
  const companyAudit = cleanQuestion.length >= 3 ? buildCompanyAudit(question, context.clients) : null
  if (companyAudit) {
    return {
      text: `Company audit for ${companyAudit.companyName}. Overall data completion is ${companyAudit.overallPercent}%.`,
      source: 'Client Master audit',
      confidence: 'Browser data',
      report: companyAudit,
      suggestions: [
        { label: 'Client Master Map', prompt: 'Client Master all tabs end to end' },
        { label: 'Annual Data', prompt: 'Explain Annual Return Data Part A Part B Part C Part D' },
        { label: 'Follow-ups', prompt: 'Explain Client Interactions Follow-Up and To-Do' }
      ]
    }
  }

  const piboFaq = findPiboOperationsAnswer(question)
  if (piboFaq) {
    return {
      text: `${piboFaq.title}: ${piboFaq.answer}`,
      source: `PIBO Operations FAQ · ${piboFaq.section}`,
      confidence: 'Official FAQ match',
      suggestions: [
        { label: 'Bulk process', prompt: 'How is a bulk procurement upload started?' },
        { label: 'Invoice validation', prompt: 'What does the Invoice Validation page display?' },
        { label: 'Common errors', prompt: 'Why can a new procurement or sales entry not be added for a past year?' }
      ]
    }
  }

  const guideMatched = guideKnowledge.find((item) => item.keywords.some((keyword) => cleanQuestion.includes(keyword)))
  if (guideMatched) {
    return {
      text: `${guideMatched.title}: ${guideMatched.answer}`,
      source: guideMatched.title,
      confidence: 'Deep guide'
    }
  }

  const clientMasterMatched = clientMasterKnowledge.find((item) => item.keywords.some((keyword) => cleanQuestion.includes(keyword)))
  if (clientMasterMatched) {
    return {
      text: `${clientMasterMatched.title}: ${clientMasterMatched.answer}`,
      source: clientMasterMatched.title,
      confidence: 'Client Master map'
    }
  }

  if (
    cleanQuestion.includes('client master') &&
    (cleanQuestion.includes('all tab') || cleanQuestion.includes('tabs') || cleanQuestion.includes('inside') || cleanQuestion.includes('end to end') || cleanQuestion.includes('full'))
  ) {
    return {
      text:
        'Client Master end-to-end tabs:\n\n1. Client form tabs: Client Basic Info, Address Details, Compliance & MSME, CTE / CTO / CCA, CPCB Details, Validation Documents, OTP & People.\n\n2. Client detail tabs: Basic Info, Company History, Quotation History, Annual Return History, Ticket.\n\n3. Client Interactions: Follow-Up and To-Do. Follow-ups are client touchpoints; To-Dos are internal assigned tasks. Both connect with Calendar data.\n\n4. Annual Return History opens year-wise annual processing. After selecting a financial year, the annual processing tabs are Basic Info, Financials, Data, and CPCB Letter.\n\n5. Annual Return Data has deeper parts: Part A - Client Data, Part B - Consent Details, Part C - Raw Data & Interaction, Part D - Plant & Declaration Details. After completion, users can submit to Manager, then Compliance Manager review happens, and the workflow can be approved or rejected.',
      source: 'Client Master map',
      confidence: 'Full flow'
    }
  }

  const matched = crmKnowledge.find((item) => item.keywords.some((keyword) => cleanQuestion.includes(keyword)))

  if (matched) {
    if (matched.title === 'Client Master') {
      return {
        text:
          'Client Master has multiple areas. Choose the part you want me to explain:',
        source: 'Client Master guide',
        confidence: 'Choose a part',
        suggestions: clientMasterSuggestions
      }
    }

    const guide = Object.values(moduleGuides).find((item) => item.title === matched.title)
    if (guide) {
      return {
        text: `${matched.title} has multiple areas. Choose the part you want me to explain:`,
        source: `${matched.title} guide`,
        confidence: 'Choose a part',
        suggestions: guide.suggestions
      }
    }

    return {
      text: `${matched.title}: ${matched.answer}`,
      source: matched.title,
      confidence: 'High match'
    }
  }

  if (cleanQuestion.includes('what can') || cleanQuestion.includes('help')) {
    return {
      text: 'I can explain CRM workflows and the PIBO Operations module, including procurement, sales, bulk templates, invoice ZIP matching, QR validation, road-construction EoL, wallet potential, legacy data and portal troubleshooting.',
      source: 'Assistant scope',
      confidence: 'Ready'
    }
  }

  if (cleanQuestion.includes('status') || cleanQuestion.includes('count')) {
    const notificationCount = getLocalCount('crm.notifications.v1')
    const calendarCount = getLocalCount('crm.calendar.todos.v1')
    return {
      text: `Current local CRM data: ${notificationCount} notification records and ${calendarCount} calendar items are available in this browser. For live business totals, check the relevant page dashboard.`,
      source: 'Browser data',
      confidence: 'Local'
    }
  }

  return {
    text: 'This looks related to the CRM workflow. Please mention the page or feature name, such as Dashboard, Calendar, Follow-ups, Lead Generation, Client Master, Add Quotation, Notifications, or Pending Approval, and I will explain it clearly.',
    source: 'CRM Guide',
    confidence: 'Needs feature name'
  }
}

export default function SidebarChatbot({ collapsed = false }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [messages, setMessages] = useState(starterMessages)
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const bodyRef = useRef(null)
  const typingTimerRef = useRef(null)

  const assistantLabel = useMemo(() => (collapsed ? 'CRM Bot' : 'CRM Assistant'), [collapsed])

  useEffect(() => {
    if (!bodyRef.current) return
    bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [messages, open, typing])

  useEffect(() => () => {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
  }, [])

  function getActiveGuide() {
    const activeGuide = Object.entries(moduleGuides).find(([, guide]) => guide.match(location.pathname))
    if (!activeGuide) return null
    const [guideKey, guide] = activeGuide
    return { guideKey, guide }
  }

  function openAssistant() {
    const activeGuide = getActiveGuide()
    setOpen(true)
    setFullscreen(false)
    setInput('')

    if (!activeGuide) {
      setMessages(starterMessages)
      return
    }

    const { guideKey, guide } = activeGuide
    setMessages([
      ...starterMessages,
      {
        id: `${guideKey}-guide-${Date.now()}`,
        role: 'bot',
        text: guide.text,
        source: `${guide.title} guide`,
        confidence: 'Context menu',
        suggestions: guide.suggestions
      }
    ])
  }

  function closeAssistant() {
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    setTyping(false)
    setFullscreen(false)
    setOpen(false)
    setInput('')
    setMessages(starterMessages)
  }

  function sendMessage(text = input) {
    const trimmed = text.trim()
    if (!trimmed || typing) return

    const userMessage = { id: `user-${Date.now()}`, role: 'user', text: trimmed }
    const answer = buildAnswer(trimmed)
    setMessages((value) => [...value, userMessage])
    setInput('')
    setOpen(true)
    setTyping(true)

    typingTimerRef.current = setTimeout(() => {
      setMessages((value) => [
        ...value,
        {
          id: `bot-${Date.now()}`,
          role: 'bot',
          text: answer.text,
          source: answer.source,
          confidence: answer.confidence,
          suggestions: answer.suggestions,
          report: answer.report
        }
      ])
      setTyping(false)
    }, 420)
  }

  return (
    <div className={`sidebar-chatbot ${collapsed ? 'is-collapsed' : ''}`}>
      <button
        type="button"
        className="sidebar-chatbot-trigger"
        onClick={() => navigate('/assistant')}
        title="CRM Assistant"
        aria-label="Open CRM Assistant"
      >
        <span className="sidebar-chatbot-trigger-icon">
          <Bot className="h-5 w-5" />
        </span>
        {!collapsed && (
          <span className="sidebar-chatbot-trigger-copy">
            <strong>{assistantLabel}</strong>
            <small>Ask about CRM workflows</small>
          </span>
        )}
        {!collapsed && <Sparkles className="h-4 w-4 text-amber-200" />}
      </button>

      <AnimatePresence>
        {open && (
        <motion.div
          className={`sidebar-chatbot-panel ${fullscreen ? 'is-fullscreen' : ''}`}
          role="dialog"
          aria-label="CRM Assistant"
          initial={{ opacity: 0, y: 18, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 14, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 340, damping: 28 }}
        >
          <div className="sidebar-chatbot-head">
            <div>
              <span><BrainCircuit className="h-4 w-4" /></span>
              <div className="sidebar-chatbot-title">
                <strong>CRM Assistant</strong>
              </div>
            </div>
            <div className="sidebar-chatbot-head-actions">
              <button type="button" onClick={() => setFullscreen((value) => !value)} aria-label={fullscreen ? 'Exit fullscreen' : 'Open fullscreen'}>
                {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
              <button type="button" onClick={closeAssistant} aria-label="Close CRM Assistant">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="sidebar-chatbot-insights">
            <span><Zap className="h-3.5 w-3.5" /> Instant guide</span>
            <span><MessageCircle className="h-3.5 w-3.5" /> CRM + PIBO FAQ trained</span>
          </div>

          <div className="sidebar-chatbot-body" ref={bodyRef}>
            <AnimatePresence initial={false}>
              {messages.map((message) => (
              <motion.div
                key={message.id}
                className={`sidebar-chatbot-message ${message.role}`}
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
              >
                {message.role === 'bot' && <Bot className="h-4 w-4" />}
                <div className="sidebar-chatbot-bubble">
                  <p>{message.text}</p>
                  {message.role === 'bot' && (
                    <small>{message.source || 'CRM Guide'} {message.confidence ? `- ${message.confidence}` : ''}</small>
                  )}
                  {message.role === 'bot' && message.report && (
                    <div className="sidebar-chatbot-report">
                      <div className="sidebar-chatbot-report-head">
                        <strong>{message.report.companyName}</strong>
                        <span>{message.report.overallPercent}% complete</span>
                      </div>
                      <div className="sidebar-chatbot-report-meta">
                        <span>ID: {message.report.uniqueId}</span>
                        <span>Owner: {message.report.owner}</span>
                        <span>Visibility: {message.report.visibility}</span>
                      </div>
                      <div className="sidebar-chatbot-report-table">
                        <table>
                          <thead>
                            <tr>
                              <th>Area</th>
                              <th>Filled</th>
                              <th>Missing</th>
                              <th>%</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {message.report.rows.map((row) => (
                              <tr key={row.section}>
                                <td>{row.section}</td>
                                <td>{row.filled}</td>
                                <td>{row.missingCount}</td>
                                <td>
                                  <span className="sidebar-chatbot-percent">
                                    <i style={{ width: `${row.percent}%` }} />
                                    <b>{row.percent}%</b>
                                  </span>
                                </td>
                                <td>{row.status}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="sidebar-chatbot-report-grid">
                        <div>
                          <strong>Current Process</strong>
                          {message.report.activeProcess.map((item) => <span key={item}>{item}</span>)}
                        </div>
                        <div>
                          <strong>Top Missing</strong>
                          {(message.report.criticalMissing.length ? message.report.criticalMissing : ['No major missing fields detected']).map((item) => <span key={item}>{item}</span>)}
                        </div>
                      </div>
                    </div>
                  )}
                  {message.role === 'bot' && Array.isArray(message.suggestions) && message.suggestions.length > 0 && (
                    <div className="sidebar-chatbot-suggestions">
                      {message.suggestions.map((suggestion) => (
                        <button
                          type="button"
                          key={suggestion.label}
                          onClick={() => sendMessage(suggestion.prompt)}
                          disabled={typing}
                        >
                          {suggestion.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
              ))}
              {typing && (
                <motion.div
                  className="sidebar-chatbot-message bot"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <Bot className="h-4 w-4" />
                  <div className="sidebar-chatbot-bubble sidebar-chatbot-typing">
                    <i />
                    <i />
                    <i />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="sidebar-chatbot-prompts">
            {quickPrompts.map((prompt) => (
              <button type="button" key={prompt.label} onClick={() => sendMessage(prompt.prompt)} disabled={typing}>
                {prompt.label}
              </button>
            ))}
          </div>

          <form
            className="sidebar-chatbot-form"
            onSubmit={(event) => {
              event.preventDefault()
              sendMessage()
            }}
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about CRM or PIBO Operations..."
              aria-label="Ask CRM Assistant"
            />
            <button type="submit" aria-label="Send question">
              <Send className="h-4 w-4" />
            </button>
          </form>

          <div className="sidebar-chatbot-foot">
            <CalendarDays className="h-3.5 w-3.5" />
            <span>Answers cover CRM workflows and the official PIBO Operations FAQ.</span>
          </div>
        </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
