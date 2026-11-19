// Kiểm tra catalog/apps.json theo schema + ràng buộc chéo (id trùng, dependency, profile, docs).
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = resolve(root, "catalog/apps.json");
const schema = JSON.parse(readFileSync(resolve(root, "catalog/apps.schema.json"), "utf8"));
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));

const errors = [];
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
if (!validate(catalog)) {
  for (const e of validate.errors) errors.push(`Schema: ${e.instancePath || "/"} ${e.message}`);
}

// Ràng buộc chéo
const ids = new Set();
for (const app of catalog.apps ?? []) {
  if (ids.has(app.id)) errors.push(`Trùng id ứng dụng: ${app.id}`);
  ids.add(app.id);
}
for (const app of catalog.apps ?? []) {
  for (const dep of app.dependencies ?? []) {
    if (!ids.has(dep)) errors.push(`App "${app.id}" phụ thuộc id không tồn tại: ${dep}`);
    if (dep === app.id) errors.push(`App "${app.id}" tự phụ thuộc chính nó`);
  }
  if (app.docs_slug && !existsSync(resolve(root, `docs/docs/apps/${app.docs_slug}.md`))) {
    errors.push(`App "${app.id}": thiếu tài liệu docs/docs/apps/${app.docs_slug}.md`);
  }
}
// Phát hiện vòng phụ thuộc
const byId = new Map((catalog.apps ?? []).map((a) => [a.id, a]));
const visiting = new Set();
const done = new Set();
function dfs(id, trail) {
  if (done.has(id)) return;
  if (visiting.has(id)) { errors.push(`Vòng phụ thuộc: ${[...trail, id].join(" -> ")}`); return; }
  visiting.add(id);
  for (const d of byId.get(id)?.dependencies ?? []) if (byId.has(d)) dfs(d, [...trail, id]);
  visiting.delete(id);
  done.add(id);
}
for (const id of byId.keys()) dfs(id, []);

const pids = new Set();
for (const p of catalog.profiles ?? []) {
  if (pids.has(p.id)) errors.push(`Trùng id profile: ${p.id}`);
  pids.add(p.id);
  for (const a of p.apps ?? []) if (!ids.has(a)) errors.push(`Profile "${p.id}" tham chiếu app không tồn tại: ${a}`);
}

if (errors.length) {
  console.error(`✗ catalog/apps.json KHÔNG hợp lệ (${errors.length} lỗi):`);
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(`✓ catalog/apps.json hợp lệ: ${catalog.apps.length} ứng dụng, ${catalog.profiles.length} profile.`);
