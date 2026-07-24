export type DraftSaveResult =
  | { status: "saved" }
  | { status: "conflict" }
  | { status: "failed"; error?: unknown };

export interface DraftSaveOperations {
  targetExists(): Promise<boolean>;
  save(): Promise<boolean | "conflict">;
}

export async function persistDraft(operations: DraftSaveOperations): Promise<DraftSaveResult> {
  try {
    if (await operations.targetExists()) return { status: "conflict" };
    const saved = await operations.save();
    if (saved === "conflict") return { status: "conflict" };
    return saved ? { status: "saved" } : { status: "failed" };
  } catch (error) {
    return { status: "failed", error };
  }
}
