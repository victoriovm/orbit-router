import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const registryDir = new URL("../open-sse/providers/registry/", import.meta.url);
const indexPath = fileURLToPath(new URL("index.js", registryDir));
let source = readFileSync(indexPath, "utf8");
// Preserve intentionally disabled imports and the existing provider order.
const knownFiles = new Set([...source.matchAll(/(?:import .* from )"\.\/([^"\n]+)"/g)].map((match) => match[1]));
const files = readdirSync(registryDir)
  .filter((file) => file.endsWith(".js") && file !== "index.js" && !knownFiles.has(file))
  .sort();
let nextIndex = Math.max(...[...source.matchAll(/\bp(\d+)\b/g)].map((match) => Number(match[1]))) + 1;
for (const file of files) {
  const binding = `p${nextIndex++}`;
  source = source.replace("export default [", `import ${binding} from "./${file}";\nexport default [`);
  source = source.replace(/\];\s*$/, `  ${binding},\n];\n`);
}
writeFileSync(indexPath, source);
