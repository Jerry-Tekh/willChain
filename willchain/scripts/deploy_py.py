"""
Deploy WillChain using the GenLayerPY client.

Usage:
    python scripts/deploy_py.py --chain studionet
    python scripts/deploy_py.py --chain localnet
    python scripts/deploy_py.py --chain testnet_asimov --private-key 0x...

Requires: pip install -r requirements.txt

NOTE ON API STABILITY: GenLayerPY is a newer, faster-moving SDK than
GenLayerJS. The calls below (create_client, deploy_contract,
wait_for_transaction_receipt, initialize_consensus_smart_contract) match the
documented patterns at https://docs.genlayer.com/api-references/genlayer-py
as of writing, but exact keyword-argument names can drift between releases.
If a call below raises a TypeError about an unexpected keyword, run
`python -c "from genlayer_py import create_client; help(create_client)"`
(and `help()` on the returned client's methods) to see the signatures
actually shipped in the genlayer-py version you installed, and adjust
accordingly. The CLI-based deploy (see README, `genlayer deploy`) is a
zero-code fallback that always matches your installed CLI version.
"""

import argparse
import os
import sys

try:
    from dotenv import load_dotenv

    load_dotenv()  # loads a root-level .env if present; no-op otherwise
except ImportError:
    pass  # python-dotenv not installed — fall back to real env vars only

from genlayer_py import create_client
from genlayer_py.chains import (
    localnet,
    studionet,
    testnet_asimov,
    testnet_bradbury,
)


CHAINS = {
    "localnet": localnet,
    "studionet": studionet,
    "testnet_asimov": testnet_asimov,
    "testnet_bradbury": testnet_bradbury,
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--chain", choices=CHAINS.keys(), default="testnet_bradbury")
    parser.add_argument(
        "--private-key",
        # Accept several env var names so the same script works whether the
        # root .env uses PRIVATE_KEY (this repo's .env), ACCOUNT_PRIVATE_KEY_1
        # (the .env.example convention), or the key is passed explicitly.
        default=(
            os.environ.get("PRIVATE_KEY")
            or os.environ.get("ACCOUNT_PRIVATE_KEY_1")
        ),
        help="Private key of the deploying account (0x...). Required for "
        "testnet_bradbury / testnet_asimov. On studionet/localnet an account "
        "is auto-provisioned if omitted.",
    )
    parser.add_argument(
        "--contract",
        default=os.path.join(os.path.dirname(__file__), "..", "contracts", "willchain.py"),
    )
    args = parser.parse_args()

    chain = CHAINS[args.chain]

    if args.private_key:
        client = create_client(chain=chain, account=args.private_key)
    else:
        client = create_client(chain=chain)

    # initialize_consensus_smart_contract() bootstraps consensus on a BRAND
    # NEW network. It's meant for a fresh local simulator (localnet), not for
    # shared networks like studionet/testnet_asimov that are already running
    # and already initialized by their operators — calling it there is
    # unnecessary at best and could error out or be disruptive at worst.
    if args.chain == "localnet":
        print("[1/4] Initializing consensus smart contract on localnet ...")
        try:
            client.initialize_consensus_smart_contract()
        except Exception as e:  # noqa: BLE001 - best-effort, see comment above
            print(f"    (already initialized or not needed — continuing) {e}")
    else:
        print(f"[1/4] Skipping consensus initialization (not needed on {args.chain}).")

    with open(args.contract, "r", encoding="utf-8") as f:
        code = f.read()

    print("[2/4] Submitting deployment transaction ...")
    tx_hash = client.deploy_contract(code=code, args=[])

    print(f"      tx hash: {tx_hash}")
    print("[3/4] Waiting for ACCEPTED status ...")
    receipt = client.wait_for_transaction_receipt(
        transaction_hash=tx_hash, status="ACCEPTED", retries=50, interval=5
    )

    contract_address = receipt.get("data", {}).get("contract_address") or receipt.get(
        "contract_address"
    )
    print(f"[4/4] Deployed. Contract address: {contract_address}")
    print()
    if args.chain == "testnet_bradbury" and contract_address:
        print(f"Explorer: https://explorer-bradbury.genlayer.com/address/{contract_address}")
        print()
    print("Save this address. Set it as an environment variable on your host")
    print("(e.g. Vercel project settings) so the frontend can find the contract:")
    print(f"  VITE_WILLCHAIN_CONTRACT_ADDRESS={contract_address}")
    print(f"  VITE_WILLCHAIN_CHAIN={args.chain}")


if __name__ == "__main__":
    sys.exit(main())
