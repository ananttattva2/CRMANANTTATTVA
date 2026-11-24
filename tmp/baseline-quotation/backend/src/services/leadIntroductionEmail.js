const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const { sendMail } = require('../utils/mailer');

const EPR_SERVICE_FILENAME = 'EPR Compliance Service.pdf';
const COMPANY_PROFILE_FILENAME = 'Company Profile - AnantTattva Private Limited.pdf';
const LOGO_FILENAME = 'ananttattva-logo.png';
const LOGO_CONTENT_ID = 'ananttattva-introduction-logo';
const ASSETS_PATH = path.join(__dirname, '..', '..', 'assets');
const LOGO_PATH = path.join(__dirname, '..', '..', '..', 'frontend', 'public', LOGO_FILENAME);

function numberedList(items) {
  return `<ol style="margin:8px 0 20px;padding-left:28px">${items.map((item) => `<li style="margin:8px 0;line-height:1.55"><strong>${item}</strong></li>`).join('')}</ol>`;
}

function buildLeadIntroductionEmail(lead = {}) {
  return {
    subject: `Introduction - AnantTattva Private Limited | ${lead.company || 'New Lead'}`,
    html: `<div style="margin:0;background:#f8fafc;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#111827">
      <div style="max-width:920px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;font-size:15px;line-height:1.65">
        <div style="margin:0;background:#f45a00;padding:14px 24px;text-align:center;color:#fff;font-size:30px;line-height:1.2;font-weight:800">AnantTattva Pvt Ltd</div>
        <div style="padding:32px">
        <p style="margin:0 0 22px">Dear Sir,</p>
        <p style="margin:0 0 18px"><strong>Greetings from AnantTattva Private Limited!</strong></p>
        <p>It was a pleasure connecting with you.</p>
        <p>We are pleased to introduce <strong>AnantTattva Private Limited</strong>, India&rsquo;s leading Government Policy Advocacy organisation, providing specialised 360-degree services related to Circular Economy and Sustainability Policies across more than 70 countries.</p>
        <p style="margin-bottom:6px">AnantTattva is recognised for facilitating industry-stakeholder interactions with government authorities, including the Ministry of MSME, DCPC, FSSAI, MoEF&amp;CC, NITI Aayog, the Department of Customs, the Ministry of Heavy Industries and the Ministry of Finance, and for policies related to:</p>
        ${numberedList(['EPR', 'ESG', 'PPWR (Europe Policy)', 'P-EPR (UK Policy)'])}
        <p>We have a widespread network of more than 20,000 industry stakeholders, including trade associations and chambers of commerce. We regularly engage with them to spread awareness of government policy initiatives and support successful implementation, enabling industry and national growth.</p>
        <p>Global manufacturing policies introduced by governments have shifted the focus of businesses from <strong>traditional production to sustainability-driven manufacturing</strong>. These policies demand stringent compliance for reporting on <strong>waste management, recycling, reuse and reduction</strong>, which is audited by Pollution Control Boards on a real-time basis.</p>
        <p>Accordingly, the management and boards of directors of brand owners, producers and recyclers are restructuring their business models with expert and specialised advisory support for market intelligence, market creation and long-term business sustainability. At AnantTattva, our team of experts has developed advanced advisory tools for organisations interested in inflation-risk management, expansion, diversification and collaboration.</p>
        <h3 style="margin:24px 0 8px;font-size:17px;text-decoration:underline">1. Sustainability-Based Market Intelligence for Market Creation</h3>
        ${numberedList(['Data Analysis Tools for Current Models', 'Business Intelligence for Potential Markets &amp; Products', 'Market Creation for Sustainable Products and Competitive Advantage'])}
        <h3 style="margin:24px 0 8px;font-size:17px;text-decoration:underline">2. Business Advisory in the Sustainability Era</h3>
        ${numberedList(['Forward &amp; Backward Integration', 'Diversification', 'Government &amp; Private Collaboration', 'Mergers &amp; Acquisitions'])}
        <p>With our network of more than 20,000 stakeholders and our successful service track record, we are recognised by leading government departments such as Customs, MSME, DCPC and Pollution Control Boards, as well as non-government organisations including FICCI, industry trade associations and chambers of commerce. We are regarded as a preferred partner for creating mass awareness of EPR policy, compliance and audit mandates, and for supporting the development of sustainable material supply-chain ecosystems.</p>
        <p>Please find our <strong>EPR Compliance Service</strong> presentation and <strong>AnantTattva Company Profile</strong> attached for your reference. We would be pleased to arrange a detailed discussion to understand your requirements and explore the way forward.</p>
        <p style="font-weight:700">Looking forward to your positive revert at the earliest and time for meeting with yourself and the team as per the convenience of all.</p>
        <div style="margin-top:26px;padding-top:18px;border-top:1px solid #e5e7eb;font-size:15px;line-height:1.7;color:#111827">
          <p style="margin:0"><strong>Thanks &amp; Regards,</strong><br/><strong>Team AnantTattva</strong></p>
          <img src="cid:${LOGO_CONTENT_ID}" alt="AnantTattva" width="150" height="60" style="display:block;width:150px;height:60px;margin:14px 0 8px;border:0" />
          <p style="margin:0 0 16px;font-weight:700;font-size:16px">आओ सब मिलकर भारत को विश्वगुरु बनाते हैं।</p>
          <p style="margin:0 0 12px;font-weight:700;font-size:16px">AnantTattva Private Limited</p>
          <p style="margin:0 0 14px">1st Floor, A/25, Technocraft House, Road No.3, MIDC, Andheri East Mumbai 400093</p>
          <p style="margin:0 0 12px;font-weight:700;font-size:15px">India’s Leading and Only Advisors for Compliance, Risk Management and Policy Advocacy for:</p>
          <p style="margin:0 0 8px">- EPR of 70+Countries</p>
          <p style="margin:0 0 8px">- ESG</p>
          <p style="margin:0 0 8px">- Circular Economy and</p>
          <p style="margin:0 0 24px">- Sustainability solutions</p>
          <p style="margin:0 0 8px;font-weight:700">Follow us on our WhatsApp Channel on:</p>
          <p style="margin:0 0 14px"><a href="https://whatsapp.com/channel/0029Va9QtNQDeONChC6Juj0t" style="color:#3f7182;text-decoration:underline">https://whatsapp.com/channel/0029Va9QtNQDeONChC6Juj0t</a></p>
          <p style="margin:0 0 8px;font-weight:700">LinkedIn:</p>
          <p style="margin:0"><a href="https://www.linkedin.com/company/anant-tattva-pvt-ltd/" style="color:#3f7182;text-decoration:underline">https://www.linkedin.com/company/anant-tattva-pvt-ltd/</a></p>
        </div>
        </div>
      </div>
    </div>`
  };
}

function getIntroductionAttachments() {
  return [EPR_SERVICE_FILENAME, COMPANY_PROFILE_FILENAME].map((filename) => ({
    filename,
    content: fs.readFileSync(path.join(ASSETS_PATH, filename)),
    contentType: 'application/pdf'
  }));
}

function getIntroductionLogoAttachment() {
  return {
    filename: LOGO_FILENAME,
    content: fs.readFileSync(LOGO_PATH),
    contentType: 'image/png',
    cid: LOGO_CONTENT_ID,
    contentId: LOGO_CONTENT_ID,
    contentDisposition: 'inline',
    isInline: true
  };
}

function getLeadEmailRecipients(lead = {}) {
  const values = [lead.emails, ...(Array.isArray(lead.contacts) ? lead.contacts.map((contact) => contact?.emails) : [])];
  return [...new Set(values.flatMap((value) => String(value || '').split(/[;,\s]+/))
    .map((email) => email.trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
}

function getIntroductionCc(creatorEmail, recipients = [], superAdminEmails = []) {
  const recipientSet = new Set(recipients.map((email) => String(email || '').trim().toLowerCase()));
  return [...new Set([creatorEmail, ...superAdminEmails]
    .map((email) => String(email || '').trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))]
    .filter((email) => !recipientSet.has(email));
}

async function sendLeadIntroductionEmail({ lead, creator }) {
  const recipients = getLeadEmailRecipients(lead);
  if (!recipients.length) return { skipped: true, reason: 'no-lead-email-recipients' };
  const originalCreator = lead?.createdBy
    ? await User.findById(lead.createdBy).select('email').lean().catch(() => null)
    : null;
  const superAdmins = await User.find({
    role: 'superadmin',
    isActive: { $ne: false },
    email: { $nin: ['', null] }
  }).select('email').lean();
  const creatorEmail = String(originalCreator?.email || lead?.createdByEmail || creator?.email || '').trim().toLowerCase();
  const cc = getIntroductionCc(creatorEmail, recipients, superAdmins.map((user) => user.email));
  const content = buildLeadIntroductionEmail(lead);
  await sendMail(recipients, content.subject, content.html, {
    branded: false,
    cc,
    attachments: [...getIntroductionAttachments(), getIntroductionLogoAttachment()]
  });
  return { sent: true, recipients, cc, attachments: [EPR_SERVICE_FILENAME, COMPANY_PROFILE_FILENAME] };
}

module.exports = { EPR_SERVICE_FILENAME, COMPANY_PROFILE_FILENAME, LOGO_FILENAME, LOGO_CONTENT_ID, buildLeadIntroductionEmail, getIntroductionAttachments, getIntroductionLogoAttachment, getLeadEmailRecipients, getIntroductionCc, sendLeadIntroductionEmail };
