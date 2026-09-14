import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Turbopack's tracer falls back to walking the project root whenever the server graph
// contains a runtime-computed filesystem path, and that walk ignores .gitignore — so
// repo-only directories get copied into the standalone output. None of these are read at
// runtime (the webpack build never shipped them), and logs/ is the one that matters most:
// it accumulates captured request/response payloads that must not travel inside a
// published CLI package or container image.
const REPO_ONLY_DIRS = ["logs", "tests", "docs", "images", "gitbook", "cli", ".github", ".vscode", ".zcode"];

function pruneRepoOnlyDirs(standaloneDir) {
  for (const name of REPO_ONLY_DIRS) {
    const target = resolve(standaloneDir, name);
    if (!existsSync(target)) continue;
    rmSync(target, { recursive: true, force: true });
    console.log(`[standalone-assets] Pruned repo-only dir from standalone: ${name}`);
  }
}

export function copyStandaloneAssets({ projectRoot = process.cwd(), distDir = process.env.NEXT_DIST_DIR || ".next" } = {}) {
  if (process.env.NEXT_TRACING_ROOT_MODE === "workspace") {
    console.log("[standalone-assets] Skipping workspace-traced CLI build; CLI packaging handles assets");
    return;
  }

  const buildDir = resolve(projectRoot, distDir);
  const standaloneDir = resolve(buildDir, "standalone");

  if (!existsSync(standaloneDir)) {
    console.log(`[standalone-assets] No standalone build found at ${standaloneDir}`);
    return;
  }

  pruneRepoOnlyDirs(standaloneDir);

  const staticSource = resolve(buildDir, "static");
  const staticDestination = resolve(standaloneDir, distDir, "static");
  if (existsSync(staticSource)) {
    cpSync(staticSource, staticDestination, { recursive: true, force: true });
    console.log(`[standalone-assets] Copied static assets to ${staticDestination}`);
  }

  const publicSource = resolve(projectRoot, "public");
  const publicDestination = resolve(standaloneDir, "public");
  if (existsSync(publicSource)) {
    cpSync(publicSource, publicDestination, { recursive: true, force: true });
    console.log(`[standalone-assets] Copied public assets to ${publicDestination}`);
  }

  // Without it beside server.js the standalone build serves requests unsanitized.
  const serverWrapperSource = resolve(projectRoot, "custom-server.js");
  const serverWrapperDestination = resolve(standaloneDir, "custom-server.js");
  if (existsSync(serverWrapperSource)) {
    cpSync(serverWrapperSource, serverWrapperDestination, { force: true });
    console.log(`[standalone-assets] Copied custom-server.js to ${serverWrapperDestination}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(dirname(fileURLToPath(import.meta.url)), "copy-standalone-assets.mjs")) {
  copyStandaloneAssets();
}
