function createEntryBudget(limit) {
  const numeric = Number(limit);
  return { remaining: Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0 };
}

function consumeEntryBudget(budget, count = 1) {
  if (!budget || typeof budget !== "object") return false;
  const requested = Math.max(1, Math.floor(Number(count) || 1));
  const remaining = Math.max(0, Math.floor(Number(budget.remaining) || 0));
  if (remaining < requested) return false;
  budget.remaining = remaining - requested;
  return true;
}

export { consumeEntryBudget, createEntryBudget };
