export type DraftSaveResult =
  | { status: "saved" }
  | { status: "conflict" }
  | { status: "failed"; error?: unknown };

export interface DraftSaveOperations {
  targetExists(): Promise<boolean>;
  save(): Promise<boolean>;
}

export async function persistDraft(operations: DraftSaveOperations): Promise<DraftSaveResult> {
  try {
    if (await operations.targetExists()) return { status: "conflict" };
    return await operations.save() ? { status: "saved" } : { status: "failed" };
  } catch (error) {
    return { status: "failed", error };
  }
}
