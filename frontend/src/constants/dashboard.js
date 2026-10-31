import {
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardList,
  Clock3,
  FileText,
  Gauge,
  Home,
  LayoutTemplate,
  Megaphone,
  LifeBuoy,
  MessagesSquare,
  UserRound,
  UserPlus,
  Users,
  BarChart3,
  TrendingUp,
  Factory
} from 'lucide-react'

export const roles = ['operation', 'admin', 'superadmin', 'manager', 'compliance', 'sales', 'accounts', 'cte-cto']
export const adminRoles = ['admin', 'superadmin']
export const isComplianceRole = (role = '') => String(role).trim().toLowerCase().replace(/[\s_-]+/g, '').includes('compliance')
export const getUserRoles = (user = {}) => [...new Set([user?.role, ...(Array.isArray(user?.roles) ? user.roles : [])]
  .map((role) => String(role || '').trim().toLowerCase())
  .filter(Boolean))]
export const hasAnyRole = (user, allowed = []) => {
  const normalizedAllowed = allowed.map((role) => String(role || '').trim().toLowerCase().replace(/[\s_-]+/g, ''))
  return getUserRoles(user).some((role) => {
    const normalized = role.replace(/[\s_-]+/g, '')
    return normalizedAllowed.includes(normalized) || (normalizedAllowed.includes('compliance') && normalized.includes('compliance'))
  })
}
export const defaultTeams = ['No team assigned', 'Operations', 'Compliance', 'Sales', 'Accounts', 'Client Success', 'Management']

export const roleLabels = {
  operation: 'Operation',
  admin: 'Admin',
  superadmin: 'Super Admin',
  manager: 'Manager',
  compliance: 'Compliance Manager',
  sales: 'Sales',
  accounts: 'Accounts',
  'cte-cto': 'CTE & CTO'
}

export const defaultUserForm = {
  firstName: '',
  lastName: '',
  email: '',
  contactNumber: '',
  password: '',
  avatarUrl: '',
  role: 'operation',
  roles: ['operation'],
  team: 'No team assigned',
  teamId: '',
  managerId: '',
  operationHeadId: '',
  isActive: true
}

export const navSections = [
  {
    label: 'Operations',
    items: [
      {
        label: 'Home',
        icon: Home,
        children: [
          {
            label: 'Dashboard',
            icon: Gauge,
            path: '/dashboard',
            children: [
              { label: 'Super Admin Dashboard', icon: Gauge, path: '/superadmin-dashboard', roles: adminRoles },
              { label: 'Sales Management MIS', icon: TrendingUp, path: '/mis', roles: [...adminRoles, 'manager', 'operation head', 'operations head'] },
              { label: 'Complete MIS', icon: BarChart3, path: '/mis/complete', roles: [...adminRoles, 'manager', 'operation head', 'operations head'] },
              { label: 'Client Daily MIS', icon: ClipboardList, path: '/mis/client-daily', roles: [...adminRoles, 'manager', 'operation head', 'operations head'] }
            ]
          },
          { label: 'Pending Approval', icon: Clock3, path: '/pending-approval', complianceFamily: true },
          {
            label: 'Pending Leads',
            icon: ClipboardList,
            children: [
              { label: 'Lead Open', icon: Clock3, path: '/pending-leads/open', roles: adminRoles },
              { label: 'Lead Close', icon: ClipboardList, path: '/pending-leads/closed', roles: adminRoles },
              { label: 'Open & Closed Leads', icon: TrendingUp, path: '/sales/lead-pipeline' }
            ]
          },
          { label: 'Notifications', icon: Bell, path: '/notifications' },
          { label: 'Announcements', icon: Megaphone, path: '/announcements' },
          { label: 'Calendar', icon: CalendarDays, path: '/calendar' },
          { label: 'User Management', icon: Users, path: '/dashboard/users' }
        ]
      }
    ]
  },
  {
    label: 'Customer Hub',
    items: [
      {
        label: 'Customer Hub',
        icon: BriefcaseBusiness,
        children: [
          { label: 'Hot Leads', icon: ClipboardList, path: '/sales/lead-generation' },
          { label: 'Cold Leads', icon: ClipboardList, path: '/sales/lead-generation?tab=temporary' },
          { label: 'Lead Allocate', icon: UserPlus, path: '/sales/lead-allocate', roles: adminRoles },
          { label: 'Client Master', icon: UserRound, path: '/sales/client-master' },
          { label: 'CTO & CTE', icon: Factory, path: '/sales/cto-cte' },
          { label: 'Client Data Uploads', icon: FileText, path: '/client-data-uploads' },
          { label: 'Client Master Allocate', icon: Users, path: '/sales/client-master-allocate', roles: [...adminRoles, 'manager'] },
          { label: 'Health Report Check', icon: ClipboardList, path: '/sales/health-report-check' },
          { label: 'Add Quotation', icon: FileText, path: '/sales/quotations?mode=add' },
          { label: 'Proforma Invoice', icon: FileText, path: '/sales/proforma-invoices' }
        ]
      }
    ]
  },
  {
    label: 'Compliance',
    items: [{ label: 'Compliance', icon: ClipboardList, roles: [...adminRoles, 'compliance', 'manager'], complianceFamily: true, children: [
      { label: 'AR Compliance', icon: ClipboardList, path: '/compliance/ar', roles: [...adminRoles, 'compliance', 'manager'], complianceFamily: true }
    ] }]
  },
  {
    label: 'Help',
    items: [
      {
        label: 'Help Yourself',
        icon: FileText,
        path: '/help-yourself'
      },
      {
        label: 'Dummey',
        icon: LayoutTemplate,
        path: '/dummey'
      },
      {
        label: 'Tickets',
        icon: MessagesSquare,
        children: [
          { label: 'Internal Tickets', icon: MessagesSquare, path: '/internal-tickets' },
          { label: 'Support Tickets', icon: LifeBuoy, path: '/support-tickets' }
        ]
      }
    ]
  }
]
