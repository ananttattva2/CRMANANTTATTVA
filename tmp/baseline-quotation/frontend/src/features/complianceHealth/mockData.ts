import type { Activity, ComplianceIssue, FrameworkScore } from './types'

const owners = {
  as: { name: 'Aarav Sharma', initials: 'AS', color: 'bg-indigo-100 text-indigo-700' },
  nm: { name: 'Neha Mehta', initials: 'NM', color: 'bg-emerald-100 text-emerald-700' },
  rk: { name: 'Rohan Kapoor', initials: 'RK', color: 'bg-orange-100 text-orange-700' },
  ps: { name: 'Priya Singh', initials: 'PS', color: 'bg-sky-100 text-sky-700' },
}

export const trendData = [
  { month: 'Aug', Overall: 71, Policies: 82, Controls: 74, Evidence: 61, Training: 68, target: 90 },
  { month: 'Sep', Overall: 73, Policies: 83, Controls: 76, Evidence: 63, Training: 70, target: 90 },
  { month: 'Oct', Overall: 72, Policies: 84, Controls: 75, Evidence: 65, Training: 71, target: 90 },
  { month: 'Nov', Overall: 76, Policies: 85, Controls: 78, Evidence: 68, Training: 73, target: 90 },
  { month: 'Dec', Overall: 75, Policies: 86, Controls: 79, Evidence: 67, Training: 74, target: 90 },
  { month: 'Jan', Overall: 78, Policies: 88, Controls: 81, Evidence: 70, Training: 76, target: 90 },
  { month: 'Feb', Overall: 79, Policies: 89, Controls: 82, Evidence: 72, Training: 77, target: 90 },
  { month: 'Mar', Overall: 77, Policies: 88, Controls: 81, Evidence: 71, Training: 76, target: 90 },
  { month: 'Apr', Overall: 80, Policies: 90, Controls: 83, Evidence: 73, Training: 78, target: 90 },
  { month: 'May', Overall: 81, Policies: 90, Controls: 85, Evidence: 75, Training: 79, target: 90 },
  { month: 'Jun', Overall: 82, Policies: 91, Controls: 86, Evidence: 76, Training: 80, target: 90 },
  { month: 'Jul', Overall: 84, Policies: 92, Controls: 87, Evidence: 78, Training: 81, target: 90 },
]

export const frameworkScores: FrameworkScore[] = [
  { name: 'ISO 27001', score: 88, completed: 44, total: 50 },
  { name: 'SOC 2', score: 84, completed: 42, total: 50 },
  { name: 'GDPR', score: 91, completed: 30, total: 33 },
  { name: 'HIPAA', score: 76, completed: 32, total: 42 },
  { name: 'PCI DSS', score: 69, completed: 25, total: 36 },
]

export const riskData = [
  { name: 'Critical', value: 3, color: '#DC2626' },
  { name: 'High', value: 7, color: '#EA580C' },
  { name: 'Medium', value: 14, color: '#D97706' },
  { name: 'Low', value: 22, color: '#16A34A' },
]

export const initialIssues: ComplianceIssue[] = [
  { id: 1, issue: 'MFA not enforced for privileged accounts', framework: 'SOC 2', severity: 'Critical', owner: owners.as, dueDate: '28 Jul 2026', status: 'Open', description: 'Eight privileged accounts can access production systems without phishing-resistant multi-factor authentication.', controls: ['CC6.1 Logical access', 'CC6.2 Authentication'], remediation: [{ id: 1, label: 'Identify all privileged accounts', done: true }, { id: 2, label: 'Enable mandatory MFA policy', done: false }, { id: 3, label: 'Collect configuration evidence', done: false }], evidence: ['privileged-account-export.csv'], activity: [{ label: 'Issue created by automated scan', time: 'Today, 10:24 AM' }, { label: 'Assigned to Aarav Sharma', time: 'Today, 10:28 AM' }] },
  { id: 2, issue: 'Vendor security review overdue', framework: 'ISO 27001', severity: 'High', owner: owners.nm, dueDate: '30 Jul 2026', status: 'In progress', description: 'Annual security reviews remain incomplete for three critical data processors.', controls: ['A.5.19 Supplier relationships'], remediation: [{ id: 1, label: 'Send vendor questionnaires', done: true }, { id: 2, label: 'Review submitted responses', done: false }], evidence: [], activity: [{ label: 'Vendor list uploaded', time: 'Yesterday, 3:10 PM' }] },
  { id: 3, issue: 'Data retention policy requires approval', framework: 'GDPR', severity: 'High', owner: owners.rk, dueDate: '02 Aug 2026', status: 'Awaiting evidence', description: 'The revised data retention schedule has not received legal and executive approval.', controls: ['Article 5(1)(e)', 'Article 30'], remediation: [{ id: 1, label: 'Complete legal review', done: true }, { id: 2, label: 'Obtain executive approval', done: false }], evidence: ['retention-policy-v3.pdf'], activity: [{ label: 'Legal review completed', time: '22 Jul, 4:42 PM' }] },
  { id: 4, issue: 'Security training evidence missing', framework: 'HIPAA', severity: 'Medium', owner: owners.ps, dueDate: '08 Aug 2026', status: 'Open', description: 'Completion certificates are missing for 14 employees in the latest training cycle.', controls: ['§164.308(a)(5)'], remediation: [{ id: 1, label: 'Contact employees', done: false }, { id: 2, label: 'Upload certificates', done: false }], evidence: [], activity: [{ label: 'Training reconciliation completed', time: '21 Jul, 11:20 AM' }] },
  { id: 5, issue: 'Quarterly access review incomplete', framework: 'SOC 2', severity: 'Medium', owner: owners.as, dueDate: '12 Aug 2026', status: 'In progress', description: 'Manager attestations are outstanding for Finance and Customer Support applications.', controls: ['CC6.3 Access removal'], remediation: [{ id: 1, label: 'Request manager attestations', done: true }, { id: 2, label: 'Close revoked access', done: false }], evidence: ['q2-access-review.xlsx'], activity: [{ label: 'Review started', time: '18 Jul, 9:15 AM' }] },
]

export const initialActivities: Activity[] = [
  { id: 1, title: 'ISO 27001 audit preparation', date: '29 Jul', owner: 'Neha Mehta', priority: 'High', complete: false },
  { id: 2, title: 'Data retention policy review', date: '02 Aug', owner: 'Rohan Kapoor', priority: 'High', complete: false },
  { id: 3, title: 'Evidence renewal — backups', date: '05 Aug', owner: 'Aarav Sharma', priority: 'Medium', complete: false },
  { id: 4, title: 'Employee training deadline', date: '08 Aug', owner: 'Priya Singh', priority: 'Medium', complete: false },
  { id: 5, title: 'Critical vendor assessment', date: '14 Aug', owner: 'Neha Mehta', priority: 'Critical', complete: false },
]
