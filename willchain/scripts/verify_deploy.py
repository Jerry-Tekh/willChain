"""
Verify a WillChain deployment (or any GenLayer tx) on Testnet Bradbury.

Usage:
    python scripts/verify_deploy.py <tx_hash>

Prints the transaction's consensus status, execution result, and — for a
successful contract deployment — the deployed contract address (which on
GenLayer is the transaction's `recipient` field).

A deploy is SUCCESSFUL when tx_execution_result_name == "FINISHED_WITH_RETURN".
"FINISHED_WITH_ERROR" with a null leader_receipt means the contract failed to
load in the GenVM (see DEPLOYMENT.md — most commonly the source is too large).

Requires: pip install -r requirements.txt  (genlayer-py, python-dotenv)
Reads PRIVATE_KEY (or ACCOUNT_PRIVATE_KEY_1) from the environment / root .env.
"""

import argparse
import os
import sys

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

from genlayer_py import create_account, create_client
from genlayer_py.chains import testnet_bradbury


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tx_hash", help="Transaction hash to inspect (0x...)")
    args = parser.parse_args()

    key = os.environ.get("PRIVATE_KEY") or os.environ.get("ACCOUNT_PRIVATE_KEY_1")
    if not key:
        sys.exit("Set PRIVATE_KEY (or ACCOUNT_PRIVATE_KEY_1) in your environment / .env")

    account = create_account(account_private_key=key)
    client = create_client(chain=testnet_bradbury, account=account)

    receipt = client.get_transaction(transaction_hash=args.tx_hash)
    status = receipt.get("status_name")
    exec_result = receipt.get("tx_execution_result_name")
    address = receipt.get("recipient")
    leader_receipt = (receipt.get("consensus_data") or {}).get("leader_receipt")

    print(f"tx:            {args.tx_hash}")
    print(f"status:        {status}")
    print(f"exec result:   {exec_result}")
    print(f"rounds:        {receipt.get('num_of_rounds')}")

    if exec_result == "FINISHED_WITH_RETURN":
        print(f"contract:      {address}")
        print(f"explorer:      https://explorer-bradbury.genlayer.com/address/{address}")
        print("\nDeployment SUCCESSFUL. Set these on your host (e.g. Vercel):")
        print(f"  VITE_WILLCHAIN_CONTRACT_ADDRESS={address}")
        print("  VITE_WILLCHAIN_CHAIN=testnet_bradbury")
        return 0

    print(f"leader_receipt: {'null' if leader_receipt is None else 'present'}")
    print("\nDeployment did NOT succeed. If exec result is FINISHED_WITH_ERROR")
    print("with a null leader_receipt, the contract failed to load in the GenVM")
    print("— most often because the source is too large (see DEPLOYMENT.md).")
    return 1


if __name__ == "__main__":
    sys.exit(main())
