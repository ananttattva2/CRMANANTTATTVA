export type Severity = 'Critical' | 'High' | 'Medium' | 'Low'
export type IssueStatus = 'Open' | 'In progress' | 'Awaiting evidence' | 'Resolved'
export type Framework = 'SOC 2' | 'ISO 27001' | 'GDPR' | 'HIPAA' | 'PCI DSS'

export interface Owner {
  name: string
  initials: string
  color: string
}

export interface ComplianceIssue {
  id: number
  issue: string
  framework: Framework
  severity: Severity
  owner: Owner
  dueDate: string
  status: IssueStatus
  description: string
  controls: string[]
  remediation: { id: number; label: string; done: boolean }[]
  evidence: string[]
  activity: { label: string; time: string }[]
}

export interface FrameworkScore {
  name: Framework
  score: number
  completed: number
  total: number
}

export interface Activity {
  id: number
  title: string
  date: string
  owner: string
  priority: Severity
  complete: boolean
}
