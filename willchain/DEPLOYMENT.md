# Deploying WillChain to Testnet Bradbury

This document captures the deployment procedure and a hard-won gotcha about
contract source size on the live GenLayer Testnet Bradbury GenVM.

## Prerequisites

- A funded Bradbury account. Put its key in a root-level `.env`:
  ```
  PRIVATE_KEY=0x...
  ACCOUNT_ADDRESS=0x...
  ```
- Python deps: `pip install -r requirements.txt` (genlayer-py, python-dotenv).

## Deploy

```bash
python scripts/deploy_py.py --chain testnet_bradbury
```

The script prints the submitted transaction hash. Then verify it:

```bash
python scripts/verify_deploy.py <tx_hash>
```

A deployment is **successful** when `verify_deploy.py` reports
`exec result: FINISHED_WITH_RETURN` and prints a contract address. On GenLayer
the deployed contract's address is the transaction's `recipient` field.

## Gotcha: contract source size limit

The live Bradbury GenVM **rejects contract source that is too large** at load
time. When this happens the deploy transaction still reaches consensus, but:

- `exec result` is `FINISHED_WITH_ERROR`
- `num_of_rounds` is `0`
- `leader_receipt` is `null`
- no contract address is assigned

This looks like a code bug but is not — the same code deploys fine once the
source is small enough. Observed on this contract (all versions had identical
executable logic, verified by comparing normalized ASTs):

| Source size | Result             |
| ----------- | ------------------ |
| ~23 KB      | FAILS              |
| ~16 KB      | Deploys reliably   |

The fix is simply to keep `contracts/willchain.py` lean. That is why the
in-file comments are terse and the long header block was removed. **If you add
code and deployment starts failing at load, trim comments/docstrings first**
before assuming your logic is wrong.

## Runtime header

The first line pins the GenVM runtime by explicit hash:

```python
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
```

The Studio-style tag `py-genlayer:test` is **not** accepted on live Bradbury —
deploying with it also ends in `FINISHED_WITH_ERROR`.

## Frontend

After a successful deploy, set these on your host (e.g. Vercel project env),
then redeploy the frontend:

```
VITE_WILLCHAIN_CONTRACT_ADDRESS=<deployed address>
VITE_WILLCHAIN_CHAIN=testnet_bradbury
```

The frontend connects to a wallet lazily: if MetaMask is present the
"Connect Wallet" button (top-right) authorizes it; otherwise a throwaway
in-browser demo account is used for reads.
