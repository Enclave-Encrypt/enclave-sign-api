import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendorRoot = join(root, "supabase", "functions", "_vendor");

const signSdkDist = resolve(root, "..", "..", "Enclave-Sign", "enclave-sign-sdk", "dist");
const pqcCoreRoot = resolve(root, "..", "enclave-pqc-core");
const pqcCoreDist = join(pqcCoreRoot, "dist");

function copyDist(source, target) {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true });
}

copyDist(signSdkDist, join(vendorRoot, "sign-sdk"));
copyDist(pqcCoreDist, join(vendorRoot, "pqc-core"));
cpSync(
  join(pqcCoreRoot, "ENCLAVE_PQ_SUITE_v1.json"),
  join(vendorRoot, "ENCLAVE_PQ_SUITE_v1.json"),
);

console.log("Vendored sign-sdk and pqc-core into supabase/functions/_vendor/");
