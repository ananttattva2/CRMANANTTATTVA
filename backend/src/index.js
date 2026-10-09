require('dotenv').config({ override: true });
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const { invalidateDashboardReads } = require('./services/dashboardReadModel');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const authRoutes = require('./routes/auth');
const leadRoutes = require('./routes/leads');
const clientRoutes = require('./routes/clients');
const quotationRoutes = require('./routes/quotations');
const proformaInvoiceRoutes = require('./routes/proformaInvoices');
const annualReturnRoutes = require('./routes/annualReturns');
const notificationRoutes = require('./routes/notifications');
const assetRoutes = require('./routes/assets');
const teamRoutes = require('./routes/teams');
const calendarItemRoutes = require('./routes/calendarItems');
const supportTicketRoutes = require('./routes/supportTickets');
const internalTicketRoutes = require('./routes/internalTickets');
const activityLogRoutes = require('./routes/activityLogs');
const complianceIntegrationRoutes = require('./routes/complianceIntegration');
const purchaseOrderRoutes = require('./routes/purchaseOrders');
const purchaseProofRoutes = require('./routes/purchaseProofs');
const healthReportAssignmentRoutes = require('./routes/healthReportAssignments');
const salesMisRoutes = require('./routes/salesMis');
const dashboardInsightsRoutes = require('./routes/dashboardInsights');
const { startPendingApprovalReminderScheduler } = require('./services/pendingApprovalNotifications');
const { runWeeklyPendingQuotationDigest } = require('./services/weeklyPendingQuotationDigest');
const { runClientComplianceCorrectionReminders, startClientComplianceCorrectionReminderScheduler } = require('./services/clientComplianceCorrectionReminders');
const { startClientOnboardingReminderScheduler, runClientOnboardingReminders } = require('./services/clientOnboardingReminders');
const { startLeadWorkflowReminderScheduler } = require('./services/leadWorkflowReminders');
const { startStaffOnboardingWorkflowScheduler } = require('./services/staffOnboardingWorkflow');
const { startLeadServiceApprovalReminderScheduler, runLeadServiceApprovalReminders } = require('./services/leadServiceApprovalReminders');
const { startProvisionalLeadClosureScheduler } = require('./services/provisionalLeadClosureWorkflow');
const { startTemporaryAssignmentReminderScheduler } = require('./services/temporaryLeadAssignmentReminders');
const { applyKnownDataCorrections } = require('./services/knownDataCorrections');
const { pauseExistingPendingClientApprovalTimers } = require('./services/clientReviewReminderLifecycle');

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection', err);
});

const app = express();
const configuredOrigins = [
  process.env.CLIENT_ORIGIN,
  process.env.CLIENT_URLS
]
  .filter(Boolean)
  .join(',');

const allowedOrigins = configuredOrigins
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const productionOrigins = [
  'https://crmananttattva.vercel.app'
];

for (const origin of productionOrigins) {
  if (!allowedOrigins.includes(origin)) allowedOrigins.push(origin);
}

app.use(cors({
  origin: (origin, callback) => callback(
    null,
    !origin || allowedOrigins.includes(origin) || /\.vercel\.app$/.test(origin)
  )
}));
app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: '12mb' }));
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && /^\/api\/(clients|leads|teams|dashboard-insights|pending-approvals)(?:\/|$)/.test(req.originalUrl)) {
    res.on('finish', () => { if (res.statusCode < 400) invalidateDashboardReads(); });
  }
  next();
});

let schedulerStarted = false;
let dbReady;
const isServerlessRuntime = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

function connectAndStartServices() {
  dbReady = connectDB();
  dbReady.then(async () => {
    await applyKnownDataCorrections().catch((error) => console.error('Known CRM data correction failed', error));
    await pauseExistingPendingClientApprovalTimers().catch((error) => console.error('Pending client reminder reconciliation failed', error));
    // Run once on every deployment/startup so legacy RED records immediately
    // receive their fresh 24-hour recovery window and email notification.
    await runClientComplianceCorrectionReminders().catch((error) => console.error('Compliance correction startup scan failed', error));
    invalidateDashboardReads();
    // Persistent interval schedulers must never run inside short-lived serverless
    // function instances. Their work is handled by explicit cron endpoints.
    if (!schedulerStarted && !isServerlessRuntime) {
      startPendingApprovalReminderScheduler();
      startClientComplianceCorrectionReminderScheduler();
      startClientOnboardingReminderScheduler();
      startLeadWorkflowReminderScheduler();
      startStaffOnboardingWorkflowScheduler();
      startLeadServiceApprovalReminderScheduler();
      startProvisionalLeadClosureScheduler();
      startTemporaryAssignmentReminderScheduler();
      schedulerStarted = true;
    }
  }).catch(error => console.error('CRM startup services failed', error));
  return dbReady;
}

connectAndStartServices().catch((err) => {
  console.error('Database startup failed', err);
});

app.use('/api', async (req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      if (mongoose.connection.readyState !== 2) connectAndStartServices();
      await dbReady;
    }
  } catch (err) {
    return res.status(503).json({
      error: 'Database unavailable. Please check MongoDB Atlas connection.',
      message: process.env.NODE_ENV === 'production' ? undefined : err.message
    });
  }
  return next();
});

app.get('/api/health', (req, res) => res.json({
  ok: true,
  database: mongoose.connection.readyState === 1 ? 'connected' : 'unavailable',
  release: String(process.env.DEPLOY_COMMIT || process.env.RENDER_GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 12) || undefined
}));

app.get('/api/internal/client-onboarding-reminders', async (req, res) => {
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  const authorization = String(req.get('authorization') || '').trim();
  if (!cronSecret) return res.status(503).json({ ok: false, error: 'CRON_SECRET is not configured' });
  if (authorization !== `Bearer ${cronSecret}`) return res.status(401).json({ ok: false, error: 'Unauthorized cron request' });
  try { return res.json({ ok: true, ...(await runClientOnboardingReminders()) }); }
  catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Reminder run failed' }); }
});
app.get('/api/internal/weekly-pending-quotation-digest', async (req, res) => {
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  const authorization = String(req.get('authorization') || '').trim();
  if (!cronSecret) return res.status(503).json({ ok: false, error: 'CRON_SECRET is not configured' });
  if (authorization !== `Bearer ${cronSecret}`) return res.status(401).json({ ok: false, error: 'Unauthorized cron request' });
  try { return res.json({ ok: true, ...(await runWeeklyPendingQuotationDigest()) }); }
  catch (error) {
    console.error('Weekly pending quotation digest failed', error);
    return res.status(500).json({ ok: false, error: error.message || 'Weekly quotation digest failed' });
  }
});
app.get('/api/internal/lead-service-approval-reminders', async (req, res) => {
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  const authorization = String(req.get('authorization') || '').trim();
  if (!cronSecret) return res.status(503).json({ ok: false, error: 'CRON_SECRET is not configured' });
  if (authorization !== `Bearer ${cronSecret}`) return res.status(401).json({ ok: false, error: 'Unauthorized cron request' });
  try { return res.json({ ok: true, ...(await runLeadServiceApprovalReminders()) }); }
  catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Service approval reminder run failed' }); }
});
app.get('/api/internal/client-compliance-correction-reminders', async (req, res) => {
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  const authorization = String(req.get('authorization') || '').trim();
  if (!cronSecret) return res.status(503).json({ ok: false, error: 'CRON_SECRET is not configured' });
  if (authorization !== `Bearer ${cronSecret}`) return res.status(401).json({ ok: false, error: 'Unauthorized cron request' });
  try { return res.json({ ok: true, ...(await runClientComplianceCorrectionReminders()) }); }
  catch (error) { return res.status(500).json({ ok: false, error: error.message || 'Compliance correction reminder run failed' }); }
});
  app.use('/api/auth', authRoutes);
  app.use('/api/assets', assetRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/quotations', quotationRoutes);
app.use('/api/proforma-invoices', proformaInvoiceRoutes);
app.use('/api/annual-returns', annualReturnRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/calendar-items', calendarItemRoutes);
app.use('/api/support-tickets', supportTicketRoutes);
app.use('/api/internal-tickets', internalTicketRoutes);
app.use('/api/activity-logs', activityLogRoutes);
app.use('/api/integrations/compliance', complianceIntegrationRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/purchase-proofs', purchaseProofRoutes);
app.use('/api/health-report-assignments', healthReportAssignmentRoutes);
app.use('/api/sales-mis', salesMisRoutes);
app.use('/api/dashboard-insights', dashboardInsightsRoutes);

app.get('/', (req, res) => res.send({
  ok: true,
  env: process.env.NODE_ENV,
  release: String(process.env.RENDER_GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 12) || undefined
}));

const PORT = process.env.PORT || 4000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
