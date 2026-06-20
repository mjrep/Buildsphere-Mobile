export const BUDGET_NOT_SET = 'Budget not set.';

export type BudgetValue = number | string | null | undefined;

const firstPresent = (...values: BudgetValue[]) =>
  values.find((value) => value !== null && value !== undefined && String(value).trim() !== '');

export function parseBudgetNumber(value: BudgetValue) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatCurrencyPHP(value: BudgetValue) {
  const amount = parseBudgetNumber(value);
  if (amount === null) return BUDGET_NOT_SET;

  const formatted = amount.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `\u20b1${formatted}`;
}

export function getProjectTotalBudget(project: Record<string, any> | null | undefined) {
  if (!project) return null;
  return parseBudgetNumber(
    firstPresent(
      project.total_budget,
      project.budget_for_materials,
      project.project_budget,
      project.budget
    )
  );
}

export function getProjectBudgetOverview(project: Record<string, any> | null | undefined) {
  const totalBudget = getProjectTotalBudget(project);
  const usedBudget = parseBudgetNumber(
    firstPresent(
      project?.used_budget,
      project?.budget_used,
      project?.actual_cost,
      project?.actualCost
    )
  );
  const providedRemaining = parseBudgetNumber(project?.remaining_budget);
  const providedUtilization = parseBudgetNumber(project?.budget_utilization);

  const remainingBudget =
    providedRemaining !== null
      ? providedRemaining
      : totalBudget !== null && usedBudget !== null
        ? totalBudget - usedBudget
        : null;
  const budgetUtilization =
    providedUtilization !== null
      ? providedUtilization
      : totalBudget !== null && totalBudget > 0 && usedBudget !== null
        ? (usedBudget / totalBudget) * 100
        : null;

  return {
    totalBudget,
    usedBudget,
    remainingBudget,
    budgetUtilization,
  };
}

export function formatBudgetPercent(value: BudgetValue) {
  const parsed = parseBudgetNumber(value);
  if (parsed === null) return null;
  return `${Math.round(parsed)}%`;
}
