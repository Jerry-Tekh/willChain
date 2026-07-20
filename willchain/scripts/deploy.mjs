/**
 * Deploy WillChain using GenLayerJS.
 *
 * Usage:
 *   node scripts/deploy.mjs --chain studionet
 *   node scripts/deploy.mjs --chain localnet
 *   node scripts/deploy.mjs --chain testnet_asimov --private-key 0x...
 *
 * Requires: npm install (see package.json in repo root / frontend)
 */

import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { createClient, createAccount } from "genlayer-js";
import { localnet, studionet, testnetAsimov } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env loader (no extra dependency, works on Node 18+): reads a
// root-level .env if present and fills in any vars not already set in the
// real environment. Only handles simple KEY=VALUE lines, which is all
// .env.example uses.
function loadDotEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
}
loadDotEnv();

const CHAINS = { localnet, studionet, testnet_asimov: testnetAsimov };

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { chain: "studionet", privateKey: process.env.ACCOUNT_PRIVATE_KEY_1 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--chain") out.chain = args[++i];
    if (args[i] === "--private-key") out.privateKey = args[++i];
  }
  return out;
}

async function main() {
  const { chain: chainName, privateKey } = parseArgs();
  const chain = CHAINS[chainName];
  if (!chain) {
    throw new Error(`Unknown chain "${chainName}". Use one of: ${Object.keys(CHAINS).join(", ")}`);
  }

  const account = privateKey ? createAccount(privateKey) : createAccount();
  if (!privateKey) {
    console.log("No --private-key / ACCOUNT_PRIVATE_KEY_1 provided.");
    console.log("Generated a throwaway account for this deployment:");
    console.log("  address:     ", account.address);
    console.log("  private key: ", account.privateKey);
    console.log("Fund this account before deploying to testnet_asimov.\n");
  }

  const client = createClient({ chain, account });

  // initializeConsensusSmartContract() bootstraps consensus on a BRAND NEW
  // network. It's meant for a fresh local simulator (localnet), not for
  // shared networks like studionet/testnet_asimov that are already running
  // and already initialized by their operators — calling it there is
  // unnecessary at best and could error out or be disruptive at worst.
  if (chainName === "localnet") {
    console.log("[1/4] Initializing consensus smart contract on localnet ...");
    try {
      await client.initializeConsensusSmartContract();
    } catch (e) {
      console.warn("    (already initialized or not needed — continuing)", e.message || e);
    }
  } else {
    console.log(`[1/4] Skipping consensus initialization (not needed on ${chainName}).`);
  }

  const contractPath = path.join(__dirname, "..", "contracts", "willchain.py");
  const contractCode = readFileSync(contractPath, "utf-8");

  console.log("[2/4] Submitting deployment transaction ...");
  const txHash = await client.deployContract({
    code: contractCode,
    args: [],
    leaderOnly: false,
  });
  console.log("      tx hash:", txHash);

  console.log("[3/4] Waiting for ACCEPTED status ...");
  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    status: TransactionStatus.ACCEPTED,
    retries: 50,
    interval: 5000,
  });

  const contractAddress = receipt.data?.contract_address ?? receipt.data?.contractAddress;
  console.log("[4/4] Deployed. Contract address:", contractAddress);
  console.log("\nSave this address — you'll need it for the frontend .env:");
  console.log(`  VITE_WILLCHAIN_CONTRACT_ADDRESS=${contractAddress}`);
  console.log(`  VITE_WILLCHAIN_CHAIN=${chainName}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
