import * as path from "node:path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, "..");
  const extensionTestsPath = path.resolve(__dirname, "suite/index");
  const workspacePath = path.resolve(extensionDevelopmentPath, "test-fixtures/workspace");

  await runTests({
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
  process.stderr.write(`Extension Host integration test failed: ${String(error)}\n`);
  process.exitCode = 1;
});
