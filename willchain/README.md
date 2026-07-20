# WillChain — AI-Executed On-Chain Estate Management

A GenLayer Intelligent Contract dApp: testators encode a will in plain
English, and when independent public evidence cross-validates the
testator's death, the contract executes the distributions itself.

> ⚠️ **Not legal advice, not a law firm, not insurance.** WillChain is a
> technical execution layer for on-chain assets. Whether an AI-executed
> smart contract constitutes a legally valid "will" depends entirely on
> your jurisdiction — in most places today it does not, on its own. Treat
> this as a mechanism for automatically moving *on-chain assets you already
> control* upon a high-confidence death determination, not as a replacement
> for a solicitor-drafted will. See "Legal & privacy considerations" below.

---

## 0. What's in this zip

```
willchain/
├── contracts/willchain.py        # the Intelligent Contract (GenVM / Python)
├── test/test_willchain.py        # gltest end-to-end tests
├── gltest.config.yaml            # localnet / studionet / testnet_bradbury config
├── pytest.ini                    # registers the 'slow' test marker
├── scripts/deploy.mjs            # deploy via GenLayerJS (Node) — recommended
├── scripts/deploy_py.py          # deploy via GenLayerPY (Python) — alternative
├── package.json                  # root-level: genlayer-js, for scripts/deploy.mjs
├── frontend/                     # Vite + React dApp (its own separate package.json)
├── requirements.txt              # gltest / genlayer-py / pytest / python-dotenv
└── .env.example                  # copy relevant parts into .env files (see §1, §2, §3)
```

---

## 1. Install dependencies

You need **Node.js ≥ 18**, **Python ≥ 3.10**, and **Docker ≥ 26** (only if
you want to run a local GenVM simulator instead of Studio/testnet).

```bash
# 1. GenLayer CLI (global) — used to run/manage GenLayer Studio & localnet
npm install -g genlayer

# 2. Optional but recommended: GenLayer Skills plugin for Claude Code.
#    This gives you the `genlayer-dev` skill (contract-building best
#    practices, linting, scaffolding) straight from the source in
#    https://skills.genlayer.com
claude /plugin marketplace add genlayerlabs/skills
# then, inside Claude Code: use the `genlayer-dev` skill when iterating on
# contracts/willchain.py further.

# 3. Python deps for testing / the Python deploy script
python -m venv .venv && source .venv/bin/activate   # optional but recommended
pip install -r requirements.txt

# 4. Node deps: root-level (needed by scripts/deploy.mjs) AND frontend
#    (kept as two separate package.json files on purpose — the deploy
#    script and the dApp UI don't need to ship each other's dependencies)
npm install
cd frontend && npm install && cd ..
```

If you hit a `libsecret` error from the CLI on a minimal Linux box:

```bash
sudo apt-get install libsecret-1-0     # Debian/Ubuntu
sudo dnf install libsecret             # Fedora
sudo pacman -S libsecret               # Arch
```

---

## 2. Deploying on GenLayer Testnet Bradbury

This build targets **Testnet Bradbury**, the live GenLayer testnet with real
validators:

| Field | Value |
|---|---|
| Network id | `testnet_bradbury` |
| Chain id | `4221` |
| RPC | `https://rpc-bradbury.genlayer.com` |
| Explorer | `https://explorer-bradbury.genlayer.com` |
| Native token | `GEN` (18 decimals) |

Because Bradbury is a real network (not Studio), you **must** supply a funded
account. Create a **root-level** `.env` (not `frontend/.env` — that's a
separate file for the frontend, see step 3):
```bash
cp .env.example .env    # at the repo root
# then edit .env and fill in a funded testnet account:
#   PRIVATE_KEY=0x...
#   ACCOUNT_ADDRESS=0x...
```
Fund the account first from the GenLayer testnet faucet (see
https://docs.genlayer.com). Both deploy scripts load this root `.env`
automatically (`scripts/deploy.mjs` via a small built-in parser,
`scripts/deploy_py.py` via `python-dotenv`) and read `PRIVATE_KEY` — you don't
need to `export` it into your shell.

### Option A — Script (recommended for repeatable deploys)
```bash
python scripts/deploy_py.py --chain testnet_bradbury
# or
node scripts/deploy.mjs --chain testnet_bradbury
```
Both default to `testnet_bradbury`, so `--chain` can be omitted. Either prints
the deployed contract address at the end — copy it.

### Option B — CLI
```bash
genlayer network            # choose "testnet_bradbury" when prompted
genlayer deploy --contract contracts/willchain.py --args
```

### Running the tests against Bradbury
```bash
gltest --network testnet_bradbury test/test_willchain.py
```
(`gltest.config.yaml` already has `testnet_bradbury` pre-configured as the
default network.)

### Other networks
`studionet` (hosted Studio) and `localnet` (local simulator) auto-provision
throwaway funded accounts, so you can deploy there with `--chain studionet` /
`--chain localnet` and no `.env`. `testnet_asimov` is the older testnet and
still works with `--chain testnet_asimov` if you have a funded Asimov account.

---

## 3. Running the frontend

The production frontend is hosted on Vercel at https://will-chain.vercel.app.
After deploying the contract, set these two variables in the Vercel project's
Environment Variables settings (then redeploy so the build picks them up):
```
VITE_WILLCHAIN_CONTRACT_ADDRESS=<address from step 2>
VITE_WILLCHAIN_CHAIN=testnet_bradbury
```

To run it locally instead:
```bash
cd frontend
cp ../.env.example .env    # then edit .env:
#   VITE_WILLCHAIN_CONTRACT_ADDRESS=<address from step 2>
#   VITE_WILLCHAIN_CHAIN=testnet_bradbury
npm install
npm run dev
```
Open the printed local URL. If MetaMask is installed it's used for signing;
otherwise the app generates a throwaway in-memory session account (fine for
Bradbury testnet demos, **not** for anything holding real value).

The UI is responsive at every width — header type scales fluidly
(`clamp()`), the two-column will list/detail + create-will layout collapses
to a single column under 800px, the beneficiary/testator input grids
collapse to one column under 560px, and long values (wallet addresses,
transaction hashes, will IDs) wrap instead of forcing horizontal scroll on
small screens. Test it by resizing the browser window or opening dev tools'
device toolbar — there's no separate "mobile build," it's the same
`frontend/` app at every size.

---

## 4. Design notes (why the contract is structured this way)

**Two ways a will can be triggered.** The original spec proposed both a
family-submitted claim (`file_death_claim`) and periodic automated
monitoring ("every N blocks"). This build ships only the family/anyone-can-
file path. Reason: GenVM non-deterministic calls (web fetch + LLM) cost
real validator compute and are billed per transaction; a contract that polls
"has this person died yet?" every N blocks for every open will is an
unbounded, self-inflicted cost with no clear trigger for *when* to start
checking. A claim-triggered design (any interested party — family, executor,
even a monitoring bot you run yourself — submits evidence when they believe
death has occurred) keeps costs proportional to actual events and keeps the
evidence-gathering step auditable (the URLs used are part of the
transaction). If you want scheduled monitoring later, the clean way to add
it on GenLayer is an off-chain cron job / bot that periodically calls
`file_death_claim` with freshly fetched evidence — not an in-protocol timer.

**The single most legally/financially sensitive decision:** the death-
confirmation threshold in `file_death_claim`. A false negative just delays
inheritance (annoying, recoverable). A false positive distributes someone's
living assets to their heirs — effectively irreversible once funds leave the
contract, and legally and personally catastrophic. The contract is designed
around that asymmetry:
- All four sub-conditions (`death_confirmed`, `confidence == "high"`,
  `person_identity_match`, `sources_independent`) must hold simultaneously —
  there's no partial-credit path to execution.
- The LLM is explicitly instructed to prefer `not confirmed` under ambiguity,
  and identity mismatches (common names, wrong city/DOB) are called out
  as an explicit rejection condition in the prompt.
- The equivalence principle used is `gl.eq_principle.strict_eq`, and the
  non-deterministic function returns *only* structured booleans/enum
  strings (no free-text reasoning) — this is deliberate: strict equality
  across independent validators only works if the compared value can't
  legitimately vary in wording between two honest runs. Free-text
  "reasoning" fields would either force a weaker equivalence principle
  (`prompt_non_comparative`, which trusts the leader more) or cause
  spurious disagreement between honest validators. Keeping the consensus
  surface to booleans/enums keeps the strict, adversarial-tolerant
  equivalence principle usable for the highest-stakes decision in the
  contract.
- A large-estate cosigner escape hatch (`cosigner` / `cosign_execution`) is
  available for testators who want a human trustee to also have to sign off
  before funds move, on top of AI verification.

**Conditional beneficiary clauses** (e.g. "if they are over 18") are
deliberately evaluated in a *separate* non-deterministic call from death
confirmation, only after death is already confirmed and only per-beneficiary.
This keeps the high-stakes death check's prompt narrowly scoped (easier to
audit, easier for validators to agree on) and lets a condition's evaluation
fail/be re-litigated (via `contest_execution` / `resolve_contest`) without
touching the already-settled death determination.

**Failure scenarios:**
- `create_will`: shares don't sum to 100, or `will_id` already exists →
  the whole call reverts (`assert`), no partial state is written, no funds
  are locked.
- `file_death_claim`: an evidence URL is unreachable → caught per-URL, the
  contract records "unavailable" for that source and still evaluates with
  whatever evidence *did* resolve. If a majority of sources fail and the
  remaining evidence is too thin, the LLM should return `sources_independent:
  false` or a non-`"high"` confidence, so the will simply stays `active`
  and a better claim can be filed later.
- `_execute_will` (a beneficiary condition prompt returns malformed JSON) →
  `json.loads` raises, the whole transaction (including any *other*
  beneficiaries' transfers already attempted earlier in the loop) is rolled
  back by GenVM's normal all-or-nothing transaction semantics; nothing is
  half-paid.
- `cosign_execution` called by someone other than the configured cosigner →
  `assert` reverts, no funds move.
- `contest_execution` called twice → blocked by `MAX_CONTEST_ROUNDS`, so a
  will can't be contested indefinitely to stall distribution forever.

---

## 5. Disputes & appeals — two different mechanisms, don't conflate them

1. **Native protocol appeal** (best option, but only works *before*
   finality): any party calls `client.appealTransaction({ txId })` (GenLayerJS)
   on the original `file_death_claim` transaction hash, within the finality
   window. This forces GenLayer's Optimistic Democracy consensus to
   re-evaluate the same non-deterministic decision with a larger validator
   set. The frontend's "Appeal last transaction" button does exactly this.
2. **`contest_execution` / `resolve_contest`** (contract-level, works any
   time after that, including post-finality): an application-level dispute
   flag + a fresh `file_death_claim` re-run with new evidence. This does
   **not** force extra validators by itself — it's a record-and-redo
   mechanism, not a protocol appeal. Use it when the finality window has
   already closed, or as a permanent on-chain paper trail of an objection
   either way.

---

## 6. Asset support

Ships with **native GEN escrow** only (`create_will` is `payable`; funds are
released via `emit_transfer` in `_execute_will`). ERC‑20 (via LayerZero),
NFTs, and other chains are extensions, not included in this build — wire
them up as additional `beneficiary` fields (`asset_type`, `token_address`)
plus the corresponding `contract_interface` calls once you've validated the
native-token path on studionet.

---

## 7. Legal & privacy considerations (unchanged from the original spec)

- Will contents here are stored as **plaintext JSON in contract state** for
  simplicity, readable by anyone querying the chain. The original spec calls
  for application-layer encryption (only decryptable with the testator's key
  or on confirmed death) — that's a real gap in this build; add it before
  putting sensitive personal/financial details in `will_narrative` or
  `testator` fields on a public network.
- Testator can update/revoke at any time while `status == "active"` via
  `revoke_will` (escrowed funds are returned to the caller — restricted to
  the original creator address).
- Jurisdiction notice: WillChain is a technical execution layer; legal
  validity as an actual will varies by country and you should treat it as
  such.

---

## 8. Audit pass — what was checked, what was found, what's left for you to verify

You asked for an in-depth check that everything is real and wired together
correctly. Here's exactly what that involved, done honestly:

**What I could not do:** this sandbox has no network access to install
`genlayer`/`genlayer-test`/`genlayer-js`, run Docker, start GenLayer Studio,
or install the Claude Code Skills plugin — so I could not literally deploy
this contract or execute `gltest`/`genvm-lint` against it. Anyone claiming
to have "run" a GenLayer contract without one of those in place is not
telling you the truth. What follows is what a careful **static** audit can
actually catch, cross-referencing every call in this repo, line by line,
against GenLayer's own published docs and package sources (fetched live
during this pass, not recalled from memory) — plus what I fixed as a result.

**Bugs found and fixed in this pass:**
1. `test/test_willchain.py` used an invented calling convention
   (`contract.method(args=[...])` returning a value directly). The real
   `genlayer-test` API wraps every call: `.call()` for reads, `.transact()`
   for writes, and success is checked via `tx_execution_succeeded(receipt)`
   rather than a raised exception. The whole test suite was rewritten
   against that documented convention, and negative-path tests
   (bad shares, missing evidence, wrong state, etc.) now assert on
   `not tx_execution_succeeded(...)` instead of `pytest.raises`.
2. The test file had an `autouse` fixture calling a `request_validators`
   helper I could not verify exists in `gltest.helpers` — since it was
   `autouse=True`, if that import were wrong it would have failed every
   single test in the file. Removed.
3. Address comparisons (`revoke_will`'s creator check, `cosign_execution`'s
   cosigner check) compared raw strings. Two representations of the same
   address that differ only in case (e.g. an EIP-55 checksummed address vs.
   all-lowercase) would wrongly fail authorization. All stored/compared
   addresses are now normalized with a `_norm_addr()` helper.
4. **Double-payment bug:** `resolve_contest` unconditionally reset
   `executed = False` and re-ran `file_death_claim`, including for wills
   whose funds had *already* been transferred out. A re-confirmed death
   would have made `_execute_will` attempt to pay beneficiaries a second
   time out of an already-spent escrow. Fixed: `contest_execution` now
   distinguishes "paused, not yet executed" (→ `contested`, safely
   re-verifiable) from "already executed" (→ new `executed_disputed`
   status: recorded permanently, but never rewound on-chain — see the
   contract comments for why). The frontend was updated with a matching
   `executed_disputed` view so that state isn't a dead end in the UI.
5. **Missing access control:** `contest_execution` had no caller
   restriction, so any unrelated address could file a dispute and
   permanently consume the will's one allowed contest round (a griefing
   vector, since `MAX_CONTEST_ROUNDS = 1`). Added `_is_interested_party()`,
   restricting contest rights to the will's creator, cosigner, or a named
   beneficiary.
6. `create_will` accepted beneficiary wallet strings without validating
   they parse as real addresses, and allowed duplicate wallets across
   beneficiaries. Both are now rejected at creation time (`Address(wallet)`
   is constructed just to force validation, and wallets are deduplicated
   case-insensitively) — better to fail loudly at creation than to have a
   malformed address blow up the distribution loop *after* death has
   already been confirmed.
7. `file_death_claim`/`contest_execution` did not dedupe or filter blank
   evidence URLs before checking the minimum-source count, so `["", ""]`
   would have passed the `len(...) >= 2` check. Both now filter empty
   strings and de-duplicate before counting.
8. **SDK version risk:** GenLayer's own docs are inconsistent about
   whether the current API is `gl.get_webpage` / `gl.exec_prompt` /
   `gl.eq_principle_strict_eq` / `gl.ContractAt` (shown in most
   Studio-facing tutorials, some quite recent) or the renamed
   `gl.nondet.web.render` / `gl.nondet.exec_prompt` /
   `gl.eq_principle.strict_eq` / `gl.get_contract_at` (shown in the
   "main"/bleeding-edge SDK reference). Since I have no way to check which
   one your target network's GenVM runtime actually has installed, the
   contract now calls through small compatibility shims
   (`_web_render`, `_llm`, `_strict_eq`, `_contract_at`) that try the new
   name and fall back to the old one, instead of gambling on one.
9. In the frontend, `<WillDetail>` was rendered without a `key`, so
   switching between wills reused the same component instance and leaked
   state across wills (stale evidence URLs, stale dispute-evidence URLs,
   and — worst — a stale transaction hash that the "Appeal" button would
   have pointed at the wrong will's transaction). Fixed by keying the
   component on `willId` and by tracking the death-claim transaction hash
   per-will (persisted in `localStorage`, not just React state, so it
   survives a page reload) instead of a single shared "last transaction"
   value that any subsequent action would silently overwrite.
10. Minor: beneficiary `share_pct` and the escrow amount could be entered
    as non-integers in the form and silently sent as floats to a field the
    contract requires to be a plain int; both are now rounded client-side
    before submission.

**Second pass — additional bugs found and fixed:**
11. **Financial correctness bug:** `_execute_will` computed each beneficiary's
    payout independently via integer floor division
    (`escrow_total * share_pct // 100`). Splits that don't divide evenly
    (e.g. three-way 33/33/34 of an escrow of 10) under-distribute by a few
    units, and those units would be permanently stranded in the contract
    with no way for anyone to claim them. Fixed: beneficiaries who actually
    get paid (conditions may exclude some) are now collected first, and the
    *last* one in that list receives the exact remainder instead of its
    floor-divided share, guaranteeing the full escrow is paid out whenever
    at least one beneficiary is eligible. (If every beneficiary's condition
    fails, there's still no payee to receive anything — a residual edge
    case noted in the contract's comments, not fully solved here.)
12. `resolve_contest` had no caller restriction at all, unlike
    `contest_execution` (which is limited to interested parties). Fixed to
    use the same `_is_interested_party` check.
13. `create_will` would throw an unhelpful raw `AttributeError` instead of a
    clean assertion message if a beneficiary entry in the JSON array wasn't
    an object (e.g. a bare string or number). Added an explicit `isinstance`
    check.
14. **Deploy scripts called `initialize*_consensus_smart_contract()`
    unconditionally for every network**, including `studionet` and
    `testnet_asimov`. That call bootstraps consensus on a brand-new network
    and is meant for a fresh local simulator only — calling it against an
    already-running shared network (exactly the "studionet" case you asked
    for) could error out and abort the whole deploy, or worse. Both
    `deploy.mjs` and `deploy_py.py` now only call it for `localnet`, and
    wrap the call defensively either way.
15. **Neither deploy script actually loaded a `.env` file**, despite the
    README instructing you to put `ACCOUNT_PRIVATE_KEY_1` etc. in one — and
    the README itself only ever told you to create `frontend/.env`, never a
    root-level one. Fixed on both sides: `deploy.mjs` now has a small
    built-in `.env` parser (no new dependency), `deploy_py.py` uses
    `python-dotenv` (added to `requirements.txt`), and the README's
    testnet_asimov section now explicitly says to `cp .env.example .env`
    at the repo root.
16. **Frontend state bug:** the "file a formal dispute" (`contest_execution`)
    and "resolve contest" (`resolve_contest`) forms shared one array of
    evidence-URL inputs, even though those are semantically different
    pieces of evidence going to two different contract calls. Split into
    separate `disputeEvidenceUrls` and `reverifyUrls` state. While fixing
    this, also noticed `resolve_contest` internally re-runs
    `file_death_claim` on-chain — meaning it produces a fresh
    death-confirmation transaction that can itself be appealed, which the
    UI wasn't tracking. It now records that transaction hash the same way
    the initial death claim does.
17. The "create a will" form never reset after a successful submission, so
    creating a second will meant manually clearing every field (and risking
    an accidental duplicate `will_id`). Fixed.

**Third pass — additional bugs found and fixed:**
18. **Deploy-blocking bug:** `scripts/deploy.mjs` imports `genlayer-js`, but
    the only `package.json` in the whole repo was `frontend/package.json`.
    Following the README's own install steps (`cd frontend && npm install`)
    would never install anything at the repo root, so running
    `node scripts/deploy.mjs` exactly as documented would fail immediately
    with "Cannot find module 'genlayer-js'". Added a root-level
    `package.json` and updated the install steps to `npm install` at the
    root *and* inside `frontend/` (kept as two separate manifests
    intentionally — the deploy script and the dApp UI don't need each
    other's dependencies).
19. `gltest.config.yaml` asserted two specifics I was never able to verify
    against a live install: the `${ACCOUNT_PRIVATE_KEY_1}`-style env-var
    interpolation syntax for `testnet_asimov` accounts, and
    `http://127.0.0.1:4000/api` as the localnet default URL/port. Both are
    reasonable, common-pattern guesses, not confirmed facts — the file now
    says so directly, with concrete guidance on what to check/do if they
    turn out to be wrong, instead of presenting them as settled.
20. The `revoked` will status had no corresponding explanation in the
    frontend — selecting a revoked will showed the basic info card and
    silently no action buttons, with nothing telling the viewer why. Added
    a short explanatory note for that status.

**What's still on you to verify before trusting this with real funds:**
- Run `genvm-lint` (from the `genlayer-dev` Skills plugin, once installed)
  against `contracts/willchain.py` — a linter written by GenLayer's own
  team will catch GenVM-specific issues no amount of doc cross-referencing
  can substitute for.
- Run `gltest --network studionet test/test_willchain.py` and confirm every
  test actually passes in a live Studio instance — this repo's tests are
  now written against the documented API, but "documented" and "what your
  installed package version actually does" are not always the same thing.
  If `.call()`/`.transact()` errors with an `AttributeError`, see the note
  at the top of `test_willchain.py` for how to adapt.
- Watch the very first `file_death_claim` you run against real evidence
  closely — confirm `will["last_claim_result"]` (visible via `get_will`)
  reflects what you expect before ever routing real value through this.
- If you add ERC-20/NFT/cross-chain support (section 6), re-run this whole
  audit against the new code paths; none of the above was written or
  checked against those extensions.

---

## 9. Reference material used to build this

- https://docs.genlayer.com — Intelligent Contracts, storage rules,
  equivalence principles, GenLayerJS/GenLayerPY/gltest references
- https://portal.genlayer.foundation/builders/ — builder resources
- https://skills.genlayer.com — the GenLayer Skills plugin for Claude Code
  (`claude /plugin marketplace add genlayerlabs/skills`)
- https://genlayer.foundation/grants — GenLayer Foundation grants
