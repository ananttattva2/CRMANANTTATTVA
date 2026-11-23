const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Client Master approval requires a complete tab-wise compliance review', () => {
  const controller = fs.readFileSync(path.join(__dirname, '../src/controllers/clientController.js'), 'utf8');
  const reviewController = fs.readFileSync(path.join(__dirname, '../src/controllers/clientComplianceReviewController.js'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/clients.js'), 'utf8');
  assert.match(controller, /Complete all Compliance Verification tabs/);
  assert.match(reviewController, /Verify every applicable tab/);
  assert.match(reviewController, /CHANGES_REQUIRED/);
  assert.match(reviewController, /Tab remarks are required before saving this review/);
  assert.match(reviewController, /Add and save remarks for every tab before approving the client/);
  assert.match(routes, /compliance-review\/sections/);
  assert.match(routes, /compliance-review\/decision/);
});

test('compliance review workspace exposes uploaded images and documents securely', () => {
  const workspace = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/ClientComplianceReview.jsx'), 'utf8');
  assert.match(workspace, /secureUrl \|\| value\.url \|\| value\.fileUrl \|\| value\.dataUrl/);
  assert.match(workspace, /Preview inside this page/);
  assert.match(workspace, /<iframe src=\{preview\.url\}/);
  assert.match(workspace, /h-\[94vh\]/);
  assert.match(workspace, /View Full Image/);
  assert.match(workspace, /target="_blank"/);
  assert.doesNotMatch(workspace, /window\.open\(file\.url/);
  assert.match(workspace, /password\|secret\|token/i);
  assert.match(workspace, /removedReviewFields/);
  assert.match(workspace, /Data not filled/);
  assert.match(workspace, /function cpcbFieldsFor/);
  assert.match(workspace, /\['registrationNumber', 'CPCB Registration Number'\]/);
  assert.match(workspace, /\['applicationNumber', 'Application Number'\]/);
  assert.match(workspace, /\['applicationDate', 'Date Of Application'\]/);
  assert.match(workspace, /\['approvalDate', 'Date Of Application Approval'\]/);
  assert.match(workspace, /if \(sectionKey === 'cpcbCredentials'\) return cpcbFieldsFor\(data\)/);
  assert.match(workspace, /'otp', 'otpContacts', 'authorised', 'authorisedPersons'/);
  assert.match(workspace, /function cteFieldsFor/);
  assert.match(workspace, /cte\.plantWiseDetails/);
  assert.match(workspace, /cteProductionRows/);
  assert.match(workspace, /ctoProductRows/);
  assert.match(workspace, /CTO\/CCA Consent Order No/);
  assert.match(workspace, /function documentFieldsFor/);
  assert.match(workspace, /\['gst', 'GST Number', 'GST Certificate Date'\]/);
  assert.match(workspace, /\['pan', 'PAN', 'PAN Document Date'\]/);
  assert.match(workspace, /\['factoryLicense', 'Factory License No\.', 'Factory License Document Date'\]/);
  assert.match(workspace, /function CteReviewTables/);
  assert.match(workspace, /function PeopleReviewTable/);
  assert.match(workspace, /Additional Authorised Person/);
  assert.match(workspace, /Name Of Product/);
  assert.match(workspace, /Partially Approve/);
  assert.match(workspace, /Final Approve/);
  assert.match(workspace, /hover:-translate-y-0\.5 hover:shadow-md/);
  assert.doesNotMatch(workspace, /DashboardShell currentUser=\{currentUser\} hideSidebar/);
  assert.match(workspace, /function MsmeReviewTable/);
  assert.match(workspace, /Registered MSME \/ Udyam Records/);
  assert.match(workspace, /function complianceHeaderMetadata/);
  assert.match(workspace, /reviewService\.applicationType, reviewService\.servicesOffered, reviewService\.applicableService, reviewService\.serviceName/);
  assert.match(workspace, /service\.applicationType, service\.servicesOffered, service\.applicableService, service\.serviceName/);
  assert.match(workspace, /\['Applicant Type', headerMetadata\.applicantTypes\]/);
  assert.match(workspace, /\['Sub Applicant Type', headerMetadata\.subApplicantTypes\]/);
  assert.match(workspace, /\['Application Type', headerMetadata\.applicationTypes\]/);
  assert.match(workspace, /getMsmeRows\(data\)/);
  assert.match(workspace, /Classification Year/);
  assert.match(workspace, /Turnover \(CR\.\)/);
  assert.match(workspace, /<MsmeReviewTable data=\{payload\?\.client\?\.data\} \/>\}\s*<section className="mt-6/);
  assert.match(workspace, /w-full max-w-none space-y-4/);
  assert.match(workspace, /allTabRemarksComplete/);
  assert.match(workspace, /disabled=\{saving === 'section' \|\| !draft\.remarks\.trim\(\)\}/);
  assert.doesNotMatch(workspace, /\['NOT_APPLICABLE','Not Applicable'/);
  assert.match(workspace, /const sectionIcons =/);
});

test('saving a tab review never changes the overall client approval bucket', () => {
  const reviewController = fs.readFileSync(path.join(__dirname, '../src/controllers/clientComplianceReviewController.js'), 'utf8');
  const clientController = fs.readFileSync(path.join(__dirname, '../src/controllers/clientController.js'), 'utf8');
  const workspace = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/ClientComplianceReview.jsx'), 'utf8');
  assert.match(reviewController, /review\.status = 'IN_REVIEW'/);
  assert.doesNotMatch(clientController, /reviewStatusByClient/);
  assert.match(workspace, /decide\('PARTIALLY_APPROVED', 'PARTIAL'\)/);
  assert.match(reviewController, /decision === 'PARTIALLY_APPROVED' \? 'PARTIALLY_APPROVED'/);
});

test('dashboard brand identifies the e-connect workspace', () => {
  const topbar = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/dashboard/Topbar.jsx'), 'utf8');
  assert.match(topbar, /<strong[^>]*>e-Connect<\/strong>/);
});

test('compliance review resolves the same assigned-service data used by Client Master', () => {
  const reviewController = fs.readFileSync(path.join(__dirname, '../src/controllers/clientComplianceReviewController.js'), 'utf8');
  const workspace = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/ClientComplianceReview.jsx'), 'utf8');
  assert.match(reviewController, /resolveClientMasterData\(client, getAssignedServiceId\(client\)\)/);
  assert.match(reviewController, /completionBySection: completionByReviewSection\(client\.data\)/);
  assert.match(reviewController, /analyzeClientMasterData\(data\)/);
  assert.match(workspace, /payload\?\.completionBySection\?\.\[section\.key\]/);
});

test('Client Master submit requires 60 percent completion and review includes process diagrams', () => {
  const clientPage = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/ClientMaster.jsx'), 'utf8');
  const clientController = fs.readFileSync(path.join(__dirname, '../src/controllers/clientController.js'), 'utf8');
  const reviewController = fs.readFileSync(path.join(__dirname, '../src/controllers/clientComplianceReviewController.js'), 'utf8');
  const reviewPage = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/ClientComplianceReview.jsx'), 'utf8');
  assert.match(clientPage, /overallProgress\.percent < 60/);
  assert.match(clientPage, /please complete at least 60% of the data/);
  assert.match(clientController, /validateClientSubmissionCompletion/);
  assert.match(clientController, /percentage < 60/);
  assert.match(reviewController, /Process Flow & Machinery Diagrams/);
  assert.match(reviewPage, /processFlowDiagrams: \['processDiagrams', 'processFlowFiles'\]/);
});
