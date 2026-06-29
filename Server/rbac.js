/**
 * RBAC helper
 *
 * Central source for mobile/backend role decisions. Executive and operations roles
 * receive broader visibility, field roles can upload/log assigned work, and staff
 * roles are limited to the modules they are allowed to use.
 */
const VIEW_ONLY_INVENTORY_MESSAGE = 'You have view-only access to Inventory.';
const USAGE_ONLY_INVENTORY_MESSAGE = 'You can only log material consumption for assigned project inventory.';
const NO_INVENTORY_ACCESS_MESSAGE = 'You do not have permission to access Inventory.';
const INACTIVE_PROJECT_WORK_MESSAGE = 'This project is not active. Actions are disabled for proposed or completed projects.';

const ROLE_ALIASES = {
  ceo_coo: 'ceo',
  chief_executive_officer: 'ceo',
  supervisor: 'project_supervisor',
  hr: 'human_resource',
  human_resources: 'human_resource',
  general_staff: 'staff',
  user: 'staff',
};

const INVENTORY_ACCESS = {
  // CEO/COO/accounting/procurement can inspect inventory; operations roles edit/log as needed.
  ceo: 'VIEW_ONLY',
  coo: 'VIEW_ONLY',
  accounting: 'VIEW_ONLY',
  foreman: 'CAN_CONSUME',
  project_supervisor: 'CAN_CONSUME',
  procurement: 'CAN_EDIT',
  project_engineer: 'CAN_EDIT',
  project_coordinator: 'CAN_EDIT',
  sales: 'NO_ACCESS',
  human_resource: 'NO_ACCESS',
  staff: 'NO_ACCESS',
  admin: 'NO_ACCESS',
};

function normalizeRole(role) {
  const key = String(role || 'staff')
    .trim()
    .toLowerCase()
    .replace(/[/-]+/g, '_')
    .replace(/[\s-]+/g, '_');
  return ROLE_ALIASES[key] || key;
}

function getInventoryAccessLevel(role) {
  const normalized = normalizeRole(role);
  return INVENTORY_ACCESS[normalized] || 'NO_ACCESS';
}

function canViewInventory(role) {
  return getInventoryAccessLevel(role) !== 'NO_ACCESS';
}

function canAccessInventory(role) {
  return canViewInventory(role);
}

function canEditInventory(role) {
  return getInventoryAccessLevel(role) === 'CAN_EDIT';
}

function canAddInventory(role) {
  return canEditInventory(role);
}

function canLogInventoryUsage(role) {
  return ['CAN_EDIT', 'CAN_CONSUME'].includes(getInventoryAccessLevel(role));
}

function canCreateTask(role) {
  return ['ceo', 'coo', 'project_engineer', 'project_coordinator'].includes(normalizeRole(role));
}

function canUploadSiteProgress(role) {
  // Site progress uploads are limited to field-facing roles responsible for site evidence.
  return ['project_engineer', 'foreman', 'project_supervisor'].includes(normalizeRole(role));
}

function normalizeProjectStatus(status) {
  return String(status || '')
    .trim()
    .toLowerCase()
    .replace(/[/-]+/g, '_')
    .replace(/[\s-]+/g, '_');
}

function isActiveProjectStatus(status) {
  // NOTE: Proposed projects are not yet active for site operations.
  // Completed projects are treated as historical/read-only records.
  const normalized = normalizeProjectStatus(status);
  return normalized === 'ongoing' || normalized === 'in_progress' || normalized === 'inprogress';
}

async function getProjectStatus(pool, projectId) {
  const result = await pool.query('SELECT status FROM projects WHERE id = $1', [projectId]);
  return result.rows[0]?.status || null;
}

async function rejectInactiveProjectWork(pool, res, projectId) {
  const status = await getProjectStatus(pool, projectId);
  if (isActiveProjectStatus(status)) return false;

  res.status(403).json({
    success: false,
    message: INACTIVE_PROJECT_WORK_MESSAGE,
  });
  return true;
}

function canViewBudget(role) {
  return ['ceo', 'coo', 'project_engineer', 'project_coordinator', 'procurement', 'accounting'].includes(normalizeRole(role));
}

function canViewReports(role) {
  return [
    'ceo',
    'coo',
    'project_engineer',
    'project_coordinator',
    'foreman',
    'project_supervisor',
    'accounting',
    'human_resource',
    'procurement',
  ].includes(normalizeRole(role));
}

function canApproveProject(role) {
  return ['ceo', 'coo'].includes(normalizeRole(role));
}

function canEditUserRoles(role) {
  return normalizeRole(role) === 'human_resource';
}

module.exports = {
  VIEW_ONLY_INVENTORY_MESSAGE,
  USAGE_ONLY_INVENTORY_MESSAGE,
  NO_INVENTORY_ACCESS_MESSAGE,
  INACTIVE_PROJECT_WORK_MESSAGE,
  normalizeRole,
  normalizeProjectStatus,
  isActiveProjectStatus,
  rejectInactiveProjectWork,
  getInventoryAccessLevel,
  canViewInventory,
  canAccessInventory,
  canEditInventory,
  canAddInventory,
  canLogInventoryUsage,
  canCreateTask,
  canUploadSiteProgress,
  canViewBudget,
  canViewReports,
  canApproveProject,
  canEditUserRoles,
};
