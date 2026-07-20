# { "Depends": "py-genlayer:test" }
#
# WillChain — AI-Executed On-Chain Estate Management
# GenLayer Intelligent Contract
#
# IMPORTANT (read before deploying to a real network):
#   The "Depends" header above pins the GenVM Python runtime. "py-genlayer:test"
#   is the tag used by GenLayer Studio and most published examples. For a
#   testnet/production deployment you should pin an explicit runtime hash
#   instead, e.g.:
#       # { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
#   Check https://docs.genlayer.com for the current recommended runtime hash
#   before you deploy real funds against this contract.
#
# SDK VERSION COMPATIBILITY:
#   GenLayer's SDK renamed several entry points between v0.1.0 and v0.1.3+:
#     v0.1.0                         v0.1.3+
#     gl.get_webpage(url, mode=...)  gl.nondet.web.render(url, mode=...)
#     gl.exec_prompt(prompt)         gl.nondet.exec_prompt(prompt)
#     gl.eq_principle_strict_eq(fn)  gl.eq_principle.strict_eq(fn)
#     gl.ContractAt(addr)            gl.get_contract_at(addr)
#   Which of these is actually live on a given Studio/studionet/testnet_asimov
#   deployment depends on which GenVM runtime build is running there, which
#   is independent of what the "latest" docs describe. Rather than gambling
#   on one API, this contract calls through the small compatibility shims
#   below, which try the new name first and fall back to the old one. If
#   BOTH names are missing on your target runtime, GenLayer has renamed
#   things again — check https://sdk.genlayer.com/main/api/changelog.html
#   and update the shims.
#
# Storage rules this file respects (GenVM persisted-state restrictions):
#   - `dict` and `list` are NOT allowed as persisted field types -> we use
#     TreeMap[str, str] (values are JSON strings) and DynArray[str].
#   - plain `int` is NOT allowed as a persisted field type -> amounts are
#     kept inside JSON strings and only cast to `u256` at the moment they
#     are used in a value transfer.
#   - non-determinism (web access, LLM calls) MUST happen inside a function
#     passed to the equivalence-principle call, never directly in a
#     write-method body.

from genlayer import *
import json
import typing


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MIN_EVIDENCE_URLS = 2
MAX_EVIDENCE_URLS = 5
MAX_EVIDENCE_CHARS_PER_SOURCE = 2000
MAX_CONTEST_ROUNDS = 1


# ---------------------------------------------------------------------------
# SDK compatibility shims (see header note above)
# ---------------------------------------------------------------------------

def _web_render(url: str, mode: str = "text") -> str:
    nondet_ns = getattr(gl, "nondet", None)
    if nondet_ns is not None and hasattr(nondet_ns, "web"):
        return nondet_ns.web.render(url, mode=mode)
    return gl.get_webpage(url, mode=mode)  # pre-v0.1.3 fallback


def _llm(prompt: str) -> str:
    nondet_ns = getattr(gl, "nondet", None)
    if nondet_ns is not None and hasattr(nondet_ns, "exec_prompt"):
        return nondet_ns.exec_prompt(prompt)
    return gl.exec_prompt(prompt)  # pre-v0.1.3 fallback


def _strict_eq(fn: typing.Callable[[], str]) -> str:
    eqp_ns = getattr(gl, "eq_principle", None)
    if eqp_ns is not None and hasattr(eqp_ns, "strict_eq"):
        return eqp_ns.strict_eq(fn)
    return gl.eq_principle_strict_eq(fn)  # pre-v0.1.3 fallback


def _contract_at(address: Address):
    if hasattr(gl, "get_contract_at"):
        return gl.get_contract_at(address)
    return gl.ContractAt(address)  # pre-v0.1.3 fallback


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _canon(obj: typing.Any) -> str:
    """Canonical JSON encoding so leader/validator strict-eq comparisons
    are stable regardless of dict key insertion order."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def _strip_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = t.split("```", 2)[1] if t.count("```") >= 2 else t.strip("`")
        t = t[4:] if t.lower().startswith("json") else t
    return t.strip()


def _norm_addr(addr: str) -> str:
    """Normalize an address string for case-insensitive comparison.
    Ethereum-style addresses are case-insensitive at the protocol level
    (mixed-case is only an EIP-55 checksum convention), so comparing raw
    strings without normalizing is a real bug: the same address typed in
    a different case would wrongly fail an authorization check."""
    return (addr or "").strip().lower()


class WillChain(gl.Contract):
    # will_id -> JSON-encoded will record
    wills: TreeMap[str, str]
    # ordered list of all will_ids, for enumeration by the frontend
    will_ids: DynArray[str]
    # contract deployer / protocol admin (kept for future maintenance hooks;
    # does NOT bypass any will's own authorization rules)
    admin: Address

    def __init__(self):
        self.admin = gl.message.sender_address

    # -----------------------------------------------------------------
    # Will creation / management
    # -----------------------------------------------------------------

    @gl.public.write.payable
    def create_will(
        self,
        will_id: str,
        testator_full_name: str,
        testator_dob: str,  # "1965-03-14"
        testator_nationality: str,
        testator_city: str,
        beneficiaries_json: str,
        # e.g. '[{"wallet":"0x...","share_pct":40,"condition":""}, ...]'
        will_narrative: str,
        cosigner: str = "",  # optional trustee address required to co-sign execution
    ) -> None:
        """Create a new will. Any native GEN token sent with this call
        (gl.message.value) is locked in the contract as the escrowed estate
        for this will_id."""
        assert len(will_id) > 0, "will_id cannot be empty"
        assert self.wills.get(will_id, None) is None, "will_id already exists"

        beneficiaries = json.loads(beneficiaries_json)
        assert isinstance(beneficiaries, list) and len(beneficiaries) > 0, (
            "beneficiaries must be a non-empty list"
        )
        total_pct = 0
        seen_wallets = set()
        for b in beneficiaries:
            assert isinstance(b, dict), "each beneficiary entry must be a JSON object"
            wallet = b.get("wallet")
            assert isinstance(wallet, str) and len(wallet) > 0, (
                "each beneficiary needs a wallet address"
            )
            # Fail fast on a malformed address rather than silently accepting
            # it here and only discovering the problem at execution time
            # (when a bad address would revert the whole distribution loop,
            # after death has already been confirmed).
            Address(wallet)
            norm = _norm_addr(wallet)
            assert norm not in seen_wallets, f"duplicate beneficiary wallet: {wallet}"
            seen_wallets.add(norm)

            share_pct = b.get("share_pct")
            assert isinstance(share_pct, int) and 0 < share_pct <= 100, (
                "share_pct must be an int between 1 and 100"
            )
            total_pct += share_pct
        assert total_pct == 100, f"beneficiary shares must sum to 100, got {total_pct}"

        if cosigner:
            Address(cosigner)  # fail fast if malformed

        record = {
            "creator": _norm_addr(str(gl.message.sender_address)),
            "testator": {
                "name": testator_full_name,
                "dob": testator_dob,
                "nationality": testator_nationality,
                "city": testator_city,
            },
            "beneficiaries": beneficiaries,
            "narrative": will_narrative,
            "escrow_total": int(gl.message.value),
            "cosigner": _norm_addr(cosigner) if cosigner else "",
            "cosigned": False,
            "status": "active",  # active | pending_execution | executed | contested | executed_disputed | revoked
            "death_confirmed": False,
            "executed": False,
            "contest_round": 0,
            "last_claim_result": None,
        }
        self.wills[will_id] = _canon(record)
        self.will_ids.append(will_id)

    @gl.public.write
    def revoke_will(self, will_id: str) -> None:
        """Testator (creator) can revoke their will at any time while it is
        still active, and reclaim the escrowed funds."""
        will = self._get_will(will_id)
        assert will["status"] == "active", "only an active will can be revoked"
        assert _norm_addr(str(gl.message.sender_address)) == will["creator"], (
            "only the will creator can revoke it"
        )
        escrow = will["escrow_total"]
        will["status"] = "revoked"
        will["escrow_total"] = 0
        self.wills[will_id] = _canon(will)
        if escrow > 0:
            _contract_at(gl.message.sender_address).emit_transfer(value=u256(escrow))

    @gl.public.view
    def get_will(self, will_id: str) -> str:
        """Returns the JSON-encoded will record."""
        raw = self.wills.get(will_id, None)
        assert raw is not None, "unknown will_id"
        return raw

    @gl.public.view
    def list_will_ids(self) -> list[str]:
        return list(self.will_ids)

    # -----------------------------------------------------------------
    # Death verification (anyone can file a claim with evidence)
    # -----------------------------------------------------------------

    @gl.public.write
    def file_death_claim(self, will_id: str, evidence_urls: list[str]) -> None:
        will = self._get_will(will_id)
        assert will["status"] == "active", "will is not active"
        deduped_urls = list(dict.fromkeys(u for u in evidence_urls if u))
        assert MIN_EVIDENCE_URLS <= len(deduped_urls), (
            f"need at least {MIN_EVIDENCE_URLS} independent, non-empty evidence sources"
        )

        t = will["testator"]
        name, dob, nationality, city = (
            t["name"],
            t["dob"],
            t["nationality"],
            t["city"],
        )
        urls = deduped_urls[:MAX_EVIDENCE_URLS]

        def verify_death() -> str:
            # NOTE: web access + LLM calls must happen inside this function,
            # because it is the one passed to the equivalence-principle call
            # below (see module header on GenVM non-determinism rules).
            evidence_text = ""
            for url in urls:
                try:
                    page = _web_render(url, mode="text")
                    evidence_text += f"\n\n--- Source: {url} ---\n{page[:MAX_EVIDENCE_CHARS_PER_SOURCE]}"
                except Exception as e:
                    evidence_text += f"\n\n--- Source: {url}: unavailable ({e}) ---"

            prompt = f"""You are verifying whether a specific named person has died,
for the sole purpose of deciding if a will should be executed. Being wrong in
either direction is costly, so be conservative: if the evidence is ambiguous,
incomplete, or could plausibly refer to a different person, do not confirm.

PERSON TO VERIFY:
- Full name: {name}
- Date of birth: {dob}
- Nationality: {nationality}
- City of residence: {city}

EVIDENCE PROVIDED:{evidence_text}

Assess the evidence and respond with ONLY a JSON object of EXACTLY this shape,
no markdown fences, no extra keys, no prose, no explanation text:
{{"death_confirmed": true or false, "confidence": "high" or "medium" or "low", "person_identity_match": true or false, "sources_independent": true or false}}

Rules:
- "death_confirmed" may only be true if you are confident the death occurred.
- "person_identity_match" must be false if the evidence could plausibly refer
  to someone else with a similar name.
- "sources_independent" must be false if the sources appear to be mirrors or
  reposts of a single original report.
"""
            raw = _llm(prompt)
            data = json.loads(_strip_fences(raw))
            # Return only structured booleans/enums (no free text) so that
            # independent validators can reach byte-for-byte strict equality.
            return _canon(
                {
                    "death_confirmed": bool(data["death_confirmed"]),
                    "confidence": str(data["confidence"]),
                    "person_identity_match": bool(data["person_identity_match"]),
                    "sources_independent": bool(data["sources_independent"]),
                }
            )

        result = json.loads(_strict_eq(verify_death))

        confirmed = (
            result["death_confirmed"] is True
            and result["confidence"] == "high"
            and result["person_identity_match"] is True
            and result["sources_independent"] is True
        )

        will["last_claim_result"] = result
        if confirmed:
            will["death_confirmed"] = True
            will["status"] = "pending_execution"
            self.wills[will_id] = _canon(will)
            self._execute_will(will_id)
        else:
            # Failed attempt kept on record; will stays active so a better
            # evidence set can be filed later.
            self.wills[will_id] = _canon(will)

    # -----------------------------------------------------------------
    # Execution
    # -----------------------------------------------------------------

    def _execute_will(self, will_id: str) -> None:
        will = self._get_will(will_id)
        if will["executed"] or will["status"] != "pending_execution":
            return

        # Large-estate safety valve: if a human trustee co-signer was set at
        # creation time, execution pauses here until cosign_execution() is
        # called by that address.
        if will["cosigner"] and not will["cosigned"]:
            self.wills[will_id] = _canon(will)
            return

        narrative = will["narrative"]
        escrow_total = will["escrow_total"]

        # First pass: work out who actually gets paid (conditions may reject
        # some beneficiaries). Kept separate from the payout pass below so
        # the remainder-assignment logic (next comment) can see the final
        # set of payees before computing any amounts.
        payees = []
        for beneficiary in will["beneficiaries"]:
            condition = beneficiary.get("condition", "") or ""
            should_pay = True

            if condition:
                def evaluate_condition() -> str:
                    cond_prompt = f"""Will text (plain English, written by the testator): "{narrative}"

Condition attached to one specific beneficiary's share: "{condition}"

This is evaluated only AFTER the testator's death has already been
independently confirmed. Based only on the will's stated intent and the
condition text, should this beneficiary receive their share right now?

Respond with ONLY a JSON object of EXACTLY this shape, no prose, no markdown:
{{"pay": true or false}}
"""
                    raw = _llm(cond_prompt)
                    data = json.loads(_strip_fences(raw))
                    return _canon({"pay": bool(data["pay"])})

                cond_result = json.loads(_strict_eq(evaluate_condition))
                should_pay = cond_result["pay"]

            if should_pay:
                payees.append(beneficiary)

        # Second pass: pay out. share_pct amounts are computed with integer
        # floor division (escrow_total * pct // 100), which on its own can
        # under-distribute the escrow by a few units of "dust" that would
        # otherwise be permanently stranded in the contract with no
        # beneficiary able to claim it (e.g. escrow_total=10 split 33/33/34
        # pays 3+3+3=9, stranding 1). To avoid that, the *last* payee in the
        # list receives the exact remainder instead of its floor-divided
        # share, guaranteeing the full escrow is distributed whenever at
        # least one beneficiary is paid. (If every beneficiary's condition
        # fails, there is no payee to receive the remainder and the escrow
        # remains locked in the contract — a currently unhandled edge case;
        # consider adding a residuary/fallback beneficiary if this matters
        # for your use case.)
        total_paid = 0
        for idx, beneficiary in enumerate(payees):
            is_last = idx == len(payees) - 1
            if is_last:
                share_amount = escrow_total - total_paid
            else:
                share_amount = (escrow_total * beneficiary["share_pct"]) // 100
            total_paid += share_amount
            if share_amount > 0:
                wallet = Address(beneficiary["wallet"])
                _contract_at(wallet).emit_transfer(value=u256(share_amount))

        will["executed"] = True
        will["status"] = "executed"
        self.wills[will_id] = _canon(will)

    @gl.public.write
    def cosign_execution(self, will_id: str) -> None:
        """Called by the designated trustee/co-signer to release a large
        estate that was paused pending human sign-off."""
        will = self._get_will(will_id)
        assert will["status"] == "pending_execution", "nothing pending for this will"
        assert will["cosigner"], "this will has no cosigner configured"
        assert _norm_addr(str(gl.message.sender_address)) == will["cosigner"], (
            "only the designated cosigner can release this will"
        )
        will["cosigned"] = True
        self.wills[will_id] = _canon(will)
        self._execute_will(will_id)

    # -----------------------------------------------------------------
    # Disputes
    # -----------------------------------------------------------------

    def _is_interested_party(self, will: dict, sender: Address) -> bool:
        """Restricts who may raise a dispute to people the will actually
        concerns: its creator, its designated cosigner, or one of its named
        beneficiaries. Left wide open, contest_execution would let any
        unrelated address block a legitimate distribution (a griefing
        vector), since MAX_CONTEST_ROUNDS permanently locks a will out of
        further contests once used."""
        s = _norm_addr(str(sender))
        if s == will["creator"]:
            return True
        if will["cosigner"] and s == will["cosigner"]:
            return True
        for b in will["beneficiaries"]:
            if s == _norm_addr(b["wallet"]):
                return True
        return False

    @gl.public.write
    def contest_execution(self, will_id: str, contest_evidence: list[str]) -> None:
        """Application-level dispute lock, restricted to interested parties
        (creator, cosigner, or a named beneficiary).

        IMPORTANT: GenLayer's native appeal mechanism (re-running consensus
        with an expanded validator set) is a PROTOCOL-level feature that must
        be triggered on the death-confirmation transaction itself, within the
        finality window, via the client SDK — e.g. in GenLayerJS:
            await client.appealTransaction({ txId: <file_death_claim tx hash> })
        That is the correct way to force the original validator decision to
        be re-checked by a larger validator set before finality.

        This method is a complementary, application-level safety net for
        disputes raised any time after that (including after finality). It
        flags the will but does NOT itself re-run AI consensus — see
        resolve_contest for that, which is only available while funds are
        still held in escrow (see note below on why that matters).
        """
        will = self._get_will(will_id)
        assert will["status"] in ("pending_execution", "executed"), (
            "nothing to contest for this will"
        )
        assert will["contest_round"] < MAX_CONTEST_ROUNDS, "already contested once"
        deduped_evidence = list(dict.fromkeys(u for u in contest_evidence if u))
        assert len(deduped_evidence) >= 1, "contest requires supporting evidence"
        assert self._is_interested_party(will, gl.message.sender_address), (
            "only the will's creator, cosigner, or a named beneficiary may contest it"
        )

        will["contest_round"] += 1
        will["contest_evidence"] = deduped_evidence[:MAX_EVIDENCE_URLS]

        if will["executed"]:
            # Funds have ALREADY left the contract's escrow at this point.
            # Resetting the will back to "active" and re-running
            # file_death_claim here would be a serious bug: _execute_will
            # would attempt to pay out escrow_total a second time even
            # though those funds are gone, either reverting on insufficient
            # contract balance or (worse, if the contract happened to hold
            # unrelated balance) paying out again from money that isn't
            # this will's. So an already-executed will can only be flagged,
            # never rewound — the dispute becomes an off-chain/legal matter
            # from this point on.
            will["status"] = "executed_disputed"
        else:
            # Not yet executed (paused pending cosigner, or otherwise not
            # yet paid out) — safe to pause and allow re-verification.
            will["status"] = "contested"

        self.wills[will_id] = _canon(will)

    @gl.public.write
    def resolve_contest(self, will_id: str, evidence_urls: list[str]) -> None:
        """Re-run death verification for a contested will using fresh
        evidence. Only available for wills paused via contest_execution
        BEFORE execution (status == "contested"); an "executed_disputed"
        will has already paid out and cannot be rewound by this contract —
        see contest_execution for why."""
        will = self._get_will(will_id)
        assert will["status"] == "contested", (
            "will is not under a re-verifiable contest (already executed "
            "disputes cannot be rewound on-chain)"
        )
        assert not will["executed"], "internal invariant violated: contested-but-executed"
        assert self._is_interested_party(will, gl.message.sender_address), (
            "only the will's creator, cosigner, or a named beneficiary may resolve its contest"
        )
        will["status"] = "active"
        will["death_confirmed"] = False
        self.wills[will_id] = _canon(will)
        self.file_death_claim(will_id, evidence_urls)

    # -----------------------------------------------------------------
    # internal helpers
    # -----------------------------------------------------------------

    def _get_will(self, will_id: str) -> dict:
        raw = self.wills.get(will_id, None)
        assert raw is not None, "unknown will_id"
        return json.loads(raw)
