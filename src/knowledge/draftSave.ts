export type DraftSaveResult =
  | { status: "saved" }
  | { status: "conflict" }
  | { status: "failed"; error?: unknown };

export interface DraftSaveOperations {
  targetExists(): Promise<boolean>;
  save(): Promise<boolean | "conflict">;
}

export interface DraftDocumentUpdateOperations {
  expectedContent: string;
  proposedContent: string;
  read(): Promise<string>;
  write(content: string): Promise<void>;
}

export interface DraftTransactionOperations extends DraftSaveOperations {
  rollbackNew(): Promise<void>;
  updates: DraftDocumentUpdateOperations[];
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

async function rollbackTransaction(
  operations: DraftTransactionOperations,
  applied: DraftDocumentUpdateOperations[],
  originalError: unknown,
): Promise<DraftSaveResult> {
  const rollbackErrors: unknown[] = [];
  for (const update of [...applied].reverse()) {
    try {
      await update.write(update.expectedContent);
    } catch (error) {
      rollbackErrors.push(error);
    }
  }
  try {
    await operations.rollbackNew();
  } catch (error) {
    rollbackErrors.push(error);
  }
  return {
    status: "failed",
    error: rollbackErrors.length
      ? new AggregateError([originalError, ...rollbackErrors], "承認済み変更の巻き戻しに失敗しました。")
      : originalError,
  };
}

export async function persistDraftTransaction(
  operations: DraftTransactionOperations,
): Promise<DraftSaveResult> {
  try {
    if (await operations.targetExists()) return { status: "conflict" };
    for (const update of operations.updates) {
      if (await update.read() !== update.expectedContent) return { status: "conflict" };
    }
    const saved = await operations.save();
    if (saved === "conflict") return { status: "conflict" };
    if (!saved) return { status: "failed" };
    return await persistApprovedDocumentUpdates(operations);
  } catch (error) {
    return { status: "failed", error };
  }
}

export async function persistApprovedDocumentUpdates(
  operations: Pick<DraftTransactionOperations, "rollbackNew" | "updates">,
): Promise<DraftSaveResult> {
  const applied: DraftDocumentUpdateOperations[] = [];
  try {
    for (const update of operations.updates) {
      if (await update.read() !== update.expectedContent) {
        try {
          await operations.rollbackNew();
          return { status: "conflict" };
        } catch (error) {
          return { status: "failed", error };
        }
      }
      applied.push(update);
      try {
        await update.write(update.proposedContent);
      } catch (error) {
        return await rollbackTransaction(
          {
            targetExists: async () => false,
            save: async () => true,
            ...operations,
          },
          applied,
          error,
        );
      }
    }
    return { status: "saved" };
  } catch (error) {
    return await rollbackTransaction(
      {
        targetExists: async () => false,
        save: async () => true,
        ...operations,
      },
      applied,
      error,
    );
  }
}
