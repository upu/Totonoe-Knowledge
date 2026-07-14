import * as path from "node:path";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";
import { retry } from "../src/testing/retry";

function formatError(error: unknown): string {
  if (error instanceof AggregateError) {
    const details = error.errors.map((nested) => formatError(nested)).join("\n");
    return `${error.stack ?? error.message}\n${details}`;
  }
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
  return String(error);
}

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, "..");
  const extensionTestsPath = path.resolve(__dirname, "suite/index");
  const workspacePath = path.resolve(extensionDevelopmentPath, "test-fixtures/workspace");
  const vscodeExecutablePath = await retry(
    () => downloadAndUnzipVSCode({
      version: "stable",
      extensionDevelopmentPath,
    }),
    {
      attempts: 3,
      delayMs: 2_000,
      onRetry: (error, nextAttempt, attempts) => {
        process.stderr.write(
          `VS Code test runtime download failed. Retrying ${nextAttempt}/${attempts}.\n${formatError(error)}\n`,
        );
      },
    },
  );

  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      workspacePath,
      "--disable-extensions",
      "--disable-workspace-trust",
      "--user-data-dir",
      path.resolve(extensionDevelopmentPath, ".vscode-test-user-data"),
    ],
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`Extension Host integration test failed:\n${formatError(error)}\n`);
  process.exitCode = 1;
});
