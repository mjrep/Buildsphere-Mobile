/**
 * BuildSphere RBAC — Final Verified Mapping
 * Stable, pure Javascript/Typescript logic for capstone defense.
 */

export type UserRole =
  | 'foreman'
  | 'project_supervisor'
  | 'supervisor'
  | 'project_engineer'
  | 'project_coordinator'
  | 'ceo'
  | 'chief_executive_officer'
  | 'coo'
  | 'procurement'
  | 'admin'
  | 'hr'
  | 'human_resource'
  | 'human_resources'
  | 'sales'
  | 'accounting'
  | 'staff'
  | 'general_staff'
  | 'user';

export type InventoryAccessLevel = 'NO_ACCESS' | 'VIEW_ONLY' | 'CAN_CONSUME' | 'CAN_EDIT';

export interface Permissions {
  canViewDashboard: boolean;
  canViewBudget: boolean;
  canCreateTasks: boolean;
  canViewInventory: boolean;
  canEditInventory: boolean;
  canAddInventory: boolean;
  canLogInventoryUsage: boolean;
  canSubmitSiteUpdates: boolean;
  canViewReports: boolean;
  canApproveProject: boolean;
  canEditUserRoles: boolean;
}

const VIEW_ONLY_INVENTORY: Pick<Permissions, 'canViewInventory' | 'canEditInventory' | 'canAddInventory' | 'canLogInventoryUsage'> = {
  canViewInventory: true,
  canEditInventory: false,
  canAddInventory: false,
  canLogInventoryUsage: false,
};

const USAGE_ONLY_INVENTORY: Pick<Permissions, 'canViewInventory' | 'canEditInventory' | 'canAddInventory' | 'canLogInventoryUsage'> = {
  canViewInventory: true,
  canEditInventory: false,
  canAddInventory: false,
  canLogInventoryUsage: true,
};

const NO_INVENTORY_ACCESS: Pick<Permissions, 'canViewInventory' | 'canEditInventory' | 'canAddInventory' | 'canLogInventoryUsage'> = {
  canViewInventory: false,
  canEditInventory: false,
  canAddInventory: false,
  canLogInventoryUsage: false,
};

const FULL_INVENTORY_ACCESS: Pick<Permissions, 'canViewInventory' | 'canEditInventory' | 'canAddInventory' | 'canLogInventoryUsage'> = {
  canViewInventory: true,
  canEditInventory: true,
  canAddInventory: true,
  canLogInventoryUsage: true,
};

const ROLE_PERMISSIONS: Record<UserRole, Permissions> = {
  ceo: {
    canViewDashboard: true,
    canViewBudget: true,
    canCreateTasks: true,
    ...VIEW_ONLY_INVENTORY,
    canSubmitSiteUpdates: false,
    canViewReports: true,
    canApproveProject: true,
    canEditUserRoles: false,
  },
  chief_executive_officer: {
    canViewDashboard: true,
    canViewBudget: true,
    canCreateTasks: true,
    ...VIEW_ONLY_INVENTORY,
    canSubmitSiteUpdates: false,
    canViewReports: true,
    canApproveProject: true,
    canEditUserRoles: false,
  },
  coo: {
    canViewDashboard: true,
    canViewBudget: true,
    canCreateTasks: true,
    ...VIEW_ONLY_INVENTORY,
    canSubmitSiteUpdates: false,
    canViewReports: true,
    canApproveProject: true,
    canEditUserRoles: false,
  },
  project_engineer: {
    canViewDashboard: true,
    canViewBudget: true,
    canCreateTasks: true,
    ...FULL_INVENTORY_ACCESS,
    canSubmitSiteUpdates: true,
    canViewReports: false,
    canApproveProject: false,
    canEditUserRoles: false,
  },
  foreman: { // or supervisor
    canViewDashboard: true,
    canViewBudget: false,
    canCreateTasks: false,
    ...USAGE_ONLY_INVENTORY,
    canSubmitSiteUpdates: true,
    canViewReports: false,
    canApproveProject: false,
    canEditUserRoles: false,
  },
  project_supervisor: {
    canViewDashboard: true,
    canViewBudget: false,
    canCreateTasks: false,
    ...USAGE_ONLY_INVENTORY,
    canSubmitSiteUpdates: true,
    canViewReports: false,
    canApproveProject: false,
    canEditUserRoles: false,
  },
  supervisor: {
    canViewDashboard: true,
    canViewBudget: false,
    canCreateTasks: false,
    ...USAGE_ONLY_INVENTORY,
    canSubmitSiteUpdates: true,
    canViewReports: false,
    canApproveProject: false,
    canEditUserRoles: false,
  },
  project_coordinator: {
    canViewDashboard: true,
    canViewBudget: true,
    canCreateTasks: true,
    ...FULL_INVENTORY_ACCESS,
    canSubmitSiteUpdates: false,
    canViewReports: true,
    canApproveProject: false,
    canEditUserRoles: false,
  },
  procurement: {
    canViewDashboard: false,
    canViewBudget: true,
    canCreateTasks: false,
    ...FULL_INVENTORY_ACCESS,
    canSubmitSiteUpdates: false,
    canViewReports: false,
    canApproveProject: false,
    canEditUserRoles: false,
  },
  admin: {
    canViewDashboard: false,
    canViewBudget: false,
    canCreateTasks: false,
    ...NO_INVENTORY_ACCESS,
    canSubmitSiteUpdates: false,
    canViewReports: false,
    canApproveProject: false,
    canEditUserRoles: false,
  },
  hr: {
    canViewDashboard: false,
    canViewBudget: false,
    canCreateTasks: false,
    ...NO_INVENTORY_ACCESS,
    canSubmitSiteUpdates: false,
    canViewReports: false,
    canApproveProject: false,
    canEditUserRoles: true,
  },
  human_resource: {
    canViewDashboard: false,
    canViewBudget: false,
    canCreateTasks: false,
    ...NO_INVENTORY_ACCESS,
    canSubmitSiteUpdates: false,
    canViewReports: false,
    canApproveProject: false,
    canEditUserRoles: true,
  },
  human_resources: {
    canViewDashboard: false,
    canViewBudget: false,
    canCreateTasks: false,
    ...NO_INVENTORY_ACCESS,
    canSubmitSiteUpdates: false,
    canViewReports: false,
    canApproveProject: false,
    canEditUserRoles: true,
  },
  sales: {
    canViewDashboard: false,
    canViewBudget: false,
    canCreateTasks: false,
    ...NO_INVENTORY_ACCESS,
    canSubmitSiteUpdates: false,
    canViewReports: false,
    canApproveProject: false,
    canEditUserRoles: false,
  },
  // Accounting: Audit-Only via Tasks (Home hidden)
  accounting: {
    canViewDashboard: false,
    canViewBudget: true,
    canCreateTasks: false,
    ...VIEW_ONLY_INVENTORY,
    canSubmitSiteUpdates: false,
    canViewReports: true,
    canApproveProject: false,
    canEditUserRoles: false,
  },
  staff: {
    canViewDashboard: false,
    canViewBudget: false,
    canCreateTasks: false,
    ...NO_INVENTORY_ACCESS,
    canSubmitSiteUpdates: false,
    canViewReports: false,
    canApproveProject: false,
    canEditUserRoles: false,
  },
  general_staff: {
    canViewDashboard: false,
    canViewBudget: false,
    canCreateTasks: false,
    ...NO_INVENTORY_ACCESS,
    canSubmitSiteUpdates: false,
    canViewReports: false,
    canApproveProject: false,
    canEditUserRoles: false,
  },
  user: {
    canViewDashboard: false,
    canViewBudget: false,
    canCreateTasks: false,
    ...NO_INVENTORY_ACCESS,
    canSubmitSiteUpdates: false,
    canViewReports: false,
    canApproveProject: false,
    canEditUserRoles: false,
  },
};

const ROLE_ALIASES: Record<string, UserRole> = {
  ceo_coo: 'ceo',
  chief_executive_officer: 'ceo',
  project_supervisor: 'project_supervisor',
  supervisor: 'project_supervisor',
  hr: 'human_resource',
  human_resources: 'human_resource',
  general_staff: 'staff',
  user: 'staff',
};

export function normalizeRole(role?: string): UserRole {
  const key = (role || 'staff')
    .toLowerCase()
    .trim()
    .replace(/[/-]+/g, '_')
    .replace(/[\s-]+/g, '_') as UserRole;
  return ROLE_ALIASES[key] || (ROLE_PERMISSIONS[key] ? key : 'staff');
}

export function getPermissions(role?: string): Permissions {
  const key = normalizeRole(role);
  return ROLE_PERMISSIONS[key] || ROLE_PERMISSIONS.staff;
}

export function getInventoryAccessLevel(role?: string): InventoryAccessLevel {
  const permissions = getPermissions(role);
  if (permissions.canEditInventory || permissions.canAddInventory) return 'CAN_EDIT';
  if (permissions.canLogInventoryUsage) return 'CAN_CONSUME';
  if (permissions.canViewInventory) return 'VIEW_ONLY';
  return 'NO_ACCESS';
}

export const canViewInventory = (role?: string) => getPermissions(role).canViewInventory;
export const canAccessInventory = canViewInventory;
export const canEditInventory = (role?: string) => getPermissions(role).canEditInventory;
export const canAddInventory = (role?: string) => getPermissions(role).canAddInventory;
export const canLogInventoryUsage = (role?: string) => getPermissions(role).canLogInventoryUsage;
export const canCreateTask = (role?: string) => getPermissions(role).canCreateTasks;
export const canUploadSiteProgress = (role?: string) => getPermissions(role).canSubmitSiteUpdates;
export const canViewBudget = (role?: string) => getPermissions(role).canViewBudget;
export const canViewReports = (role?: string) => getPermissions(role).canViewReports;
export const canApproveProject = (role?: string) => getPermissions(role).canApproveProject;
export const canEditUserRoles = (role?: string) => getPermissions(role).canEditUserRoles;
