const ArComplianceList = lazy(() => import('./pages/ArCompliance'))
import React, { Suspense, lazy, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import ScrollToTop from './components/ScrollToTop'
const Login = lazy(() => import('./pages/Login'))
const LandingPage = lazy(() => import('./pages/LandingPage'))
const VerifyOtp = lazy(() => import('./pages/VerifyOtp'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'))
const LeadGeneration = lazy(() => import('./pages/LeadGeneration'))
const ClientMaster = lazy(() => import('./pages/ClientMaster'))
const ClientMasterAllocate = lazy(() => import('./pages/ClientMasterAllocate'))
const LeadAllocate = lazy(() => import('./pages/LeadAllocate'))
const HealthReportCheck = lazy(() => import('./pages/HealthReportCheck'))
const Quotations = lazy(() => import('./pages/Quotations'))
const AnnualReturns = lazy(() => import('./pages/AnnualReturns'))
const CalendarTodo = lazy(() => import('./pages/CalendarTodo'))
const Notifications = lazy(() => import('./pages/Notifications'))
const PendingApproval = lazy(() => import('./pages/PendingApproval'))
const ClientComplianceReview = lazy(() => import('./pages/ClientComplianceReview'))
const NotFound = lazy(() => import('./pages/NotFound'))
const AssistantPage = lazy(() => import('./pages/AssistantPage'))
const ProformaInvoices = lazy(() => import('./pages/ProformaInvoices'))
const ComplianceHealthDashboard = lazy(() => import('./pages/ComplianceHealthDashboard'))
const PendingLeads = lazy(() => import('./pages/PendingLeads'))
const HelpYourself = lazy(() => import('./pages/HelpYourself'))
const SupportTickets = lazy(() => import('./pages/SupportTickets'))
const InternalTickets = lazy(() => import('./pages/InternalTickets'))
const SuperAdminDashboard = lazy(() => import('./pages/SuperAdminDashboard'))
const ActivityLogs = lazy(() => import('./pages/ActivityLogs'))
const SalesManagementDashboard = lazy(() => import('./pages/SalesManagementDashboard'))
const ClientDailyMIS = lazy(() => import('./pages/ClientDailyMIS'))
const Dummey = lazy(() => import('./pages/Dummey'))
const OverallDashboard = lazy(() => import('./pages/OverallDashboard'))
const PurchaseOrderDashboard = lazy(() => import('./pages/PurchaseOrderDashboard'))
const PurchaseSalesDashboard = lazy(() => import('./pages/PurchaseSalesDashboard'))
import api, { API_ENDPOINTS, hasStoredAuthToken } from './services/api'
import SupportTicketMilestoneCelebration from './components/SupportTicketMilestoneCelebration'

function ActiveCrmTracker() {
  useEffect(() => {
    let timer
    let idleTimer
    let loggingOut = false
    let heartbeatInFlight = false
    let heartbeatDelay = 60000
    const IDLE_LOGOUT_MS = 30 * 60 * 1000
    const MAX_HEARTBEAT_DELAY_MS = 5 * 60 * 1000
    const isActive = () => hasStoredAuthToken() && document.visibilityState === 'visible' && document.hasFocus()
    const scheduleHeartbeat = () => {
      clearTimeout(timer)
      if (isActive()) timer = window.setTimeout(() => heartbeat('active'), heartbeatDelay)
    }
    const heartbeat = async (state = 'active') => {
      if (heartbeatInFlight || !hasStoredAuthToken()) return
      heartbeatInFlight = true
      try {
        await api.post(API_ENDPOINTS.auth.activityHeartbeat, { state })
        heartbeatDelay = 60000
      } catch (error) {
        if ([429, 502, 503, 504].includes(error?.response?.status)) heartbeatDelay = Math.min(heartbeatDelay * 2, MAX_HEARTBEAT_DELAY_MS)
      } finally {
        heartbeatInFlight = false
        if (state === 'active') scheduleHeartbeat()
      }
    }
    const refresh = () => {
      clearTimeout(timer)
      if (isActive()) { heartbeat('active'); resetIdleTimer() }
      else if (hasStoredAuthToken()) heartbeat('away')
    }
    const clearLocalSession = () => {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      localStorage.removeItem('login_email')
      localStorage.removeItem('dev_otp')
    }
    const logoutForInactivity = async () => {
      if (loggingOut || !hasStoredAuthToken()) return
      loggingOut = true
      clearTimeout(timer)
      try { await api.post(API_ENDPOINTS.auth.logout, { reason: 'inactivity' }) } catch {}
      clearLocalSession()
      window.location.replace('/')
    }
    const resetIdleTimer = () => {
      if (!hasStoredAuthToken() || loggingOut) return
      clearTimeout(idleTimer)
      idleTimer = window.setTimeout(logoutForInactivity, IDLE_LOGOUT_MS)
    }
    const activityEvents = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'scroll']
    activityEvents.forEach((eventName) => window.addEventListener(eventName, resetIdleTimer, { passive: true }))
    window.addEventListener('focus', refresh)
    window.addEventListener('blur', refresh)
    document.addEventListener('visibilitychange', refresh)
    refresh()
    resetIdleTimer()
    return () => { clearTimeout(timer); clearTimeout(idleTimer); activityEvents.forEach((eventName) => window.removeEventListener(eventName, resetIdleTimer)); window.removeEventListener('focus', refresh); window.removeEventListener('blur', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  return null
}

function App(){
  return (
    <div className="min-h-screen bg-emerald-50">
      <ScrollToTop />
      <ActiveCrmTracker />
      <SupportTicketMilestoneCelebration />
      <Suspense fallback={<div role="status" className="grid min-h-[60vh] place-items-center text-teal-700">Loading page…</div>}>
      <Routes>
        <Route path="/" element={<LandingPage/>} />
        <Route path="/login" element={<Login/>} />
        <Route path="/verify" element={<VerifyOtp/>} />
        <Route path="/forgot-password" element={<ForgotPassword/>} />
        <Route path="/forget-password" element={<Navigate to="/forgot-password" replace />} />
        <Route path="/forgotpassword" element={<Navigate to="/forgot-password" replace />} />
        <Route path="/dashboard" element={<ProtectedRoute><AdminDashboard/></ProtectedRoute>} />
        <Route path="/dashboard/users" element={<ProtectedRoute allowedRoles={['admin', 'superadmin']}><AdminDashboard/></ProtectedRoute>} />
        <Route path="/superadmin-dashboard" element={<ProtectedRoute allowedRoles={['admin', 'superadmin']}><SuperAdminDashboard/></ProtectedRoute>} />
        <Route path="/mis" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'manager', 'operation head', 'operations head']}><SalesManagementDashboard /></ProtectedRoute>} />
        <Route path="/mis/complete" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'manager', 'operation head', 'operations head']}><SuperAdminDashboard misPage /></ProtectedRoute>} />
        <Route path="/mis/client-daily" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'manager', 'operation head', 'operations head']}><ClientDailyMIS /></ProtectedRoute>} />
        <Route path="/mis/sales-management" element={<Navigate to="/mis" replace />} />
        <Route path="/dashboard/activity-logs" element={<ProtectedRoute allowedRoles={['admin', 'superadmin']}><ActivityLogs/></ProtectedRoute>} />
        <Route path="/overall-dashboard" element={<ProtectedRoute><OverallDashboard/></ProtectedRoute>} />
        <Route path="/po-dashboard" element={<ProtectedRoute><PurchaseOrderDashboard/></ProtectedRoute>} />
        <Route path="/purchase-sales-dashboard" element={<ProtectedRoute><PurchaseSalesDashboard/></ProtectedRoute>} />
        <Route path="/pending-approval" element={<ProtectedRoute><PendingApproval/></ProtectedRoute>} />
        <Route path="/compliance/ar" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'compliance', 'manager']}><ArComplianceList/></ProtectedRoute>} />
        <Route path="/compliance/ar/:clientId" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'compliance', 'manager']}><ClientComplianceReview defaultAr/></ProtectedRoute>} />
        <Route path="/pending-approval/clients/:clientId/review" element={<ProtectedRoute allowedRoles={['admin', 'superadmin', 'compliance']}><ClientComplianceReview/></ProtectedRoute>} />
        <Route path="/pending-leads" element={<Navigate to="/pending-leads/open" replace />} />
        <Route path="/pending-leads/open" element={<ProtectedRoute allowedRoles={['admin', 'superadmin']}><PendingLeads mode="open"/></ProtectedRoute>} />
        <Route path="/pending-leads/closed" element={<ProtectedRoute allowedRoles={['admin', 'superadmin']}><PendingLeads mode="closed"/></ProtectedRoute>} />
        <Route path="/notifications" element={<ProtectedRoute><Notifications/></ProtectedRoute>} />
        <Route path="/announcements" element={<ProtectedRoute><Notifications mode="announcements"/></ProtectedRoute>} />
        <Route path="/calendar" element={<ProtectedRoute><CalendarTodo/></ProtectedRoute>} />
        <Route path="/assistant" element={<ProtectedRoute><AssistantPage/></ProtectedRoute>} />
        <Route path="/sales/lead-generation" element={<ProtectedRoute><LeadGeneration/></ProtectedRoute>} />
        <Route path="/sales/lead-allocate" element={<ProtectedRoute allowedRoles={['admin', 'superadmin']}><LeadAllocate/></ProtectedRoute>} />
        <Route path="/sales/lead-generation/temporary" element={<Navigate to="/sales/lead-generation?tab=temporary" replace />} />
        <Route path="/sales/compliance-health-report/:leadId" element={<ProtectedRoute><LeadGeneration/></ProtectedRoute>} />
        <Route path="/compliance/health-report" element={<ProtectedRoute><ComplianceHealthDashboard/></ProtectedRoute>} />
        <Route path="/sales/client-master" element={<ProtectedRoute><ClientMaster/></ProtectedRoute>} />
        <Route path="/sales/client-master-allocate" element={<ProtectedRoute><ClientMasterAllocate/></ProtectedRoute>} />
        <Route path="/sales/health-report-check" element={<ProtectedRoute><HealthReportCheck/></ProtectedRoute>} />
        <Route path="/sales/client-annual-returns/:clientKey" element={<ProtectedRoute><ClientMaster/></ProtectedRoute>} />
        <Route path="/sales/client-data-processing/:clientKey/:annualYear" element={<ProtectedRoute><ClientMaster/></ProtectedRoute>} />
        <Route path="/sales/annual-returns" element={<ProtectedRoute><AnnualReturns/></ProtectedRoute>} />
        <Route path="/sales/quotations" element={<ProtectedRoute><Quotations/></ProtectedRoute>} />
        <Route path="/sales/proforma-invoices" element={<ProtectedRoute><ProformaInvoices/></ProtectedRoute>} />
        <Route path="/help-yourself" element={<ProtectedRoute><HelpYourself/></ProtectedRoute>} />
        <Route path="/dummey" element={<ProtectedRoute><Dummey/></ProtectedRoute>} />
        <Route path="/support-tickets" element={<ProtectedRoute><SupportTickets/></ProtectedRoute>} />
        <Route path="/internal-tickets" element={<ProtectedRoute><InternalTickets/></ProtectedRoute>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
    </div>
  )
}

export default App
