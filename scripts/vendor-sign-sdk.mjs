import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendorRoot = join(root, "supabase", "functions", "_vendor");

const signSdkDist = resolve(root, "..", "..", "Enclave-Sign", "enclave-sign-sdk", "dist");
const pqcPrimitivesRoot = resolve(
  root,
  "..",
  "..",
  "Enclave-Inc",
  "enclave-pqc-primitives",
);
const pqcPrimitivesDist = join(pqcPrimitivesRoot, "dist");

function copyDist(source, target) {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true });
}

copyDist(signSdkDist, join(vendorRoot, "sign-sdk"));
copyDist(pqcPrimitivesDist, join(vendorRoot, "pqc-primitives"));
cpSync(
  join(pqcPrimitivesRoot, "registry", "ENCLAVE_PQ_SUITE_v1.json"),
  join(vendorRoot, "ENCLAVE_PQ_SUITE_v1.json"),
);

console.log("Vendored sign-sdk and pqc-primitives into supabase/functions/_vendor/");
