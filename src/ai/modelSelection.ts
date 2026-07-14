export interface IdentifiedModel {
  id: string;
}

export function orderModelsByPreviousSelection<T extends IdentifiedModel>(
  models: readonly T[],
  previousModelId: string | undefined,
): T[] {
  if (!previousModelId) return [...models];
  return [...models].sort((left, right) => {
    const leftWasPrevious = left.id === previousModelId;
    const rightWasPrevious = right.id === previousModelId;
    if (leftWasPrevious === rightWasPrevious) return 0;
    return leftWasPrevious ? -1 : 1;
  });
}
