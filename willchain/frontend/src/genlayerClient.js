import { createClient, createAccount } from "genlayer-js";
import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const CHAINS = {
  localnet,
  studionet,
  testnet_asimov: testnetAsimov,
  testnet_bradbury: testnetBradbury,
};

const CHAIN_NAME = import.meta.env.VITE_WILLCHAIN_CHAIN || "testnet_bradbury";
// Exported so the UI can show which network it's talking to (Bradbury by default).
export const CHAIN_LABEL = CHAIN_NAME;
export const CONTRACT_ADDRESS = import.meta.env.VITE_WILLCHAIN_CONTRACT_ADDRESS || "";

const chain = CHAINS[CHAIN_NAME] || testnetBradbury;

/** True if an injected EVM wallet (MetaMask etc.) is available in the browser. */
export function hasInjectedWallet() {
  return typeof window !== "undefined" && !!window.ethereum;
}

/**
 * Returns the already-connected wallet address WITHOUT prompting, or null if
 * no wallet is connected yet. Uses eth_accounts (silent) rather than
 * eth_requestAccounts (which pops the MetaMask dialog).
 */
export async function getConnectedAddress() {
  if (!hasInjectedWallet()) return null;
  try {
    const accounts = await window.ethereum.request({ method: "eth_accounts" });
    return accounts && accounts.length ? accounts[0] : null;
  } catch {
    return null;
  }
}

/**
 * Explicitly prompts the user to connect their wallet (MetaMask dialog) and
 * returns the selected address. This backs the "Connect Wallet" button.
 * Throws if no injected wallet is present.
 */
export async function connectWallet() {
  if (!hasInjectedWallet()) {
    throw new Error(
      "No wallet detected. Install MetaMask (or another EVM wallet) to connect."
    );
  }
  const [address] = await window.ethereum.request({
    method: "eth_requestAccounts",
  });
  return address;
}

/**
 * Ensures the injected wallet is on the chain this app targets (Bradbury by
 * default). If the wallet is on a different network (e.g. Ethereum mainnet,
 * chain 1), this prompts MetaMask to switch — and, if the chain isn't known to
 * the wallet yet, to add it first. No-op when there's no injected wallet
 * (burner-account path) or the wallet is already on the right chain.
 *
 * This fixes the "Wallet is on chain 1 but client is configured for chain 4221"
 * RPC error thrown when sending a transaction from the wrong network.
 */
export async function ensureChain() {
  if (!hasInjectedWallet()) return;

  const targetHex = "0x" + chain.id.toString(16);
  const currentHex = await window.ethereum.request({ method: "eth_chainId" });
  if (currentHex === targetHex) return;

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: targetHex }],
    });
  } catch (switchError) {
    // 4902 = chain not added to the wallet yet; add it, then it becomes active.
    if (switchError && (switchError.code === 4902 || switchError.code === -32603)) {
      const rpcUrl = chain.rpcUrls?.default?.http?.[0];
      const explorer = chain.blockExplorers?.default?.url;
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: targetHex,
            chainName: chain.name || CHAIN_NAME,
            nativeCurrency: chain.nativeCurrency || {
              name: "GEN",
              symbol: "GEN",
              decimals: 18,
            },
            rpcUrls: rpcUrl ? [rpcUrl] : [],
            blockExplorerUrls: explorer ? [explorer] : [],
          },
        ],
      });
    } else {
      throw switchError;
    }
  }
}

/**
 * Returns a GenLayerJS client.
 *
 * - If MetaMask (window.ethereum) is present, the client is created with the
 *   connected address and MetaMask handles signing. If the wallet is not yet
 *   authorized this triggers the connection prompt, and if it's on the wrong
 *   network it is asked to switch to the target chain.
 * - Otherwise, a session-only burner account is generated in-memory
 *   (fine for localnet/studionet demos; NOT for real funds).
 */
export async function getClient() {
  if (hasInjectedWallet()) {
    const address =
      (await getConnectedAddress()) || (await connectWallet());
    await ensureChain();
    return createClient({ chain, account: address });
  }
  if (!window.__willchainBurnerAccount) {
    window.__willchainBurnerAccount = createAccount();
    console.warn(
      "No wallet detected — using a throwaway in-memory account for this " +
        "session only. Install MetaMask to use a persistent account."
    );
  }
  return createClient({ chain, account: window.__willchainBurnerAccount });
}

export async function readWillChain(functionName, args = []) {
  if (!CONTRACT_ADDRESS) {
    throw new Error(
      "Set VITE_WILLCHAIN_CONTRACT_ADDRESS in frontend/.env after deploying the contract."
    );
  }
  const client = await getClient();
  return client.readContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args,
  });
}

export async function writeWillChain(functionName, args = [], value = 0) {
  if (!CONTRACT_ADDRESS) {
    throw new Error(
      "Set VITE_WILLCHAIN_CONTRACT_ADDRESS in frontend/.env after deploying the contract."
    );
  }
  // NOTE ON LARGE VALUES: `value` is passed through as a plain JS number,
  // matching published genlayer-js examples. JS numbers lose precision
  // above Number.MAX_SAFE_INTEGER (2^53-1) — fine for typical demo escrow
  // amounts, but if you plan to escrow very large integers, check whether
  // your installed genlayer-js version's writeContract() accepts a BigInt
  // for `value` (most EVM-style SDKs do) and pass one instead of relying
  // on this function's plain-number default.
  const client = await getClient();
  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args,
    value,
  });
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.ACCEPTED,
    retries: 100,
    interval: 5000,
  });
  return { hash, receipt };
}

/**
 * Appeals a still-open (not-yet-finalized) transaction, asking validators to
 * re-run consensus with an expanded validator set. This is the correct way
 * to contest a death-confirmation decision BEFORE it finalizes — see
 * README "Disputes & appeals".
 */
export async function appealTransaction(txHash) {
  const client = await getClient();
  const appealHash = await client.appealTransaction({ txId: txHash });
  const receipt = await client.waitForTransactionReceipt({
    hash: appealHash,
    status: TransactionStatus.ACCEPTED,
    retries: 100,
    interval: 5000,
  });
  return { appealHash, receipt };
}
