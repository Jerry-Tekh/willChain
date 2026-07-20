"""
End-to-end tests for the WillChain Intelligent Contract, using the
GenLayer Testing Suite (`gltest`).

Run against Testnet Bradbury (the deployment target for this repo):

    gltest --network testnet_bradbury test/test_willchain.py

Run against Studio (hosted, auto-provisioned accounts):

    gltest --network studionet test/test_willchain.py

Run against local simulator:

    gltest --network localnet test/test_willchain.py

API NOTE (read this if a call below errors with an AttributeError):
gltest's documented calling convention (per pypi.org/project/genlayer-test)
is:
    result    = contract.some_view_method(args=[...]).call()      # reads
    tx_receipt = contract.some_write_method(args=[...]).transact()  # writes
    assert tx_execution_succeeded(tx_receipt)
i.e. calling a method returns a builder object, and .call()/.transact()
actually executes it against the network. This file follows that
convention throughout. If your installed gltest version instead returns
the result directly from the method call (some published examples show
that too, so the ergonomics may have changed release to release), drop the
trailing .call()/.transact() and adjust the tx_execution_succeeded() checks
to plain pytest.raises(...) blocks instead. Run `pip show genlayer-test`
and check its changelog if you hit this.

Every test that exercises file_death_claim performs a REAL non-deterministic
call (web fetch + LLM). These are marked `slow` and skipped by default —
see test_file_death_claim_end_to_end at the bottom for how to enable them.
"""

import json
import pytest
from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded


BENEFICIARY_WALLET_A = "0x0000000000000000000000000000000000AAAA"
BENEFICIARY_WALLET_B = "0x0000000000000000000000000000000000BBBB"
BENEFICIARY_WALLET_C = "0x0000000000000000000000000000000000CCCC"


@pytest.fixture()
def willchain_contract():
    factory = get_contract_factory("WillChain")
    contract = factory.deploy(args=[])
    return contract


def _create_simple_will(contract, will_id, wallet=BENEFICIARY_WALLET_A, value=0):
    beneficiaries = json.dumps(
        [{"wallet": wallet, "share_pct": 100, "condition": ""}]
    )
    tx_receipt = contract.create_will(
        args=[
            will_id,
            "Alex Example",
            "1950-05-20",
            "CA",
            "Toronto",
            beneficiaries,
            "Everything to my nephew.",
            "",
        ],
        value=value,
    ).transact()
    assert tx_execution_succeeded(tx_receipt), f"create_will failed: {tx_receipt}"
    return tx_receipt


# ---------------------------------------------------------------------------
# Deterministic tests (no web/LLM calls) — these should be fast and reliable
# ---------------------------------------------------------------------------

def test_create_will_and_read_back(willchain_contract):
    beneficiaries = json.dumps(
        [
            {"wallet": BENEFICIARY_WALLET_A, "share_pct": 60, "condition": ""},
            {"wallet": BENEFICIARY_WALLET_B, "share_pct": 40, "condition": ""},
        ]
    )
    tx_receipt = willchain_contract.create_will(
        args=[
            "will-001",
            "Jane Q. Doe",
            "1965-03-14",
            "US",
            "Austin",
            beneficiaries,
            "I leave 60% to my daughter Sarah and 40% to my son Mark.",
            "",
        ],
        value=0,
    ).transact()
    assert tx_execution_succeeded(tx_receipt)

    raw = willchain_contract.get_will(args=["will-001"]).call()
    will = json.loads(raw)
    assert will["status"] == "active"
    assert will["death_confirmed"] is False
    assert len(will["beneficiaries"]) == 2

    ids = willchain_contract.list_will_ids(args=[]).call()
    assert "will-001" in ids


def test_create_will_rejects_bad_shares(willchain_contract):
    bad_beneficiaries = json.dumps(
        [{"wallet": BENEFICIARY_WALLET_A, "share_pct": 50, "condition": ""}]
    )
    tx_receipt = willchain_contract.create_will(
        args=[
            "will-bad-shares",
            "John Smith",
            "1970-01-01",
            "GB",
            "London",
            bad_beneficiaries,
            "Everything to my only child.",
            "",
        ],
        value=0,
    ).transact()
    assert not tx_execution_succeeded(tx_receipt), (
        "create_will should have reverted: shares only sum to 50, not 100"
    )
    # The will must not exist after a reverted create_will.
    ids = willchain_contract.list_will_ids(args=[]).call()
    assert "will-bad-shares" not in ids


def test_create_will_rejects_duplicate_will_id(willchain_contract):
    _create_simple_will(willchain_contract, "will-dup")
    beneficiaries = json.dumps(
        [{"wallet": BENEFICIARY_WALLET_B, "share_pct": 100, "condition": ""}]
    )
    tx_receipt = willchain_contract.create_will(
        args=[
            "will-dup",
            "Someone Else",
            "1960-01-01",
            "US",
            "Denver",
            beneficiaries,
            "A different will entirely.",
            "",
        ],
        value=0,
    ).transact()
    assert not tx_execution_succeeded(tx_receipt), "duplicate will_id must be rejected"


def test_create_will_rejects_duplicate_beneficiary_wallet(willchain_contract):
    beneficiaries = json.dumps(
        [
            {"wallet": BENEFICIARY_WALLET_A, "share_pct": 50, "condition": ""},
            {"wallet": BENEFICIARY_WALLET_A, "share_pct": 50, "condition": ""},
        ]
    )
    tx_receipt = willchain_contract.create_will(
        args=[
            "will-dup-wallet",
            "Someone",
            "1970-01-01",
            "US",
            "Miami",
            beneficiaries,
            "Split between... the same person twice by mistake.",
            "",
        ],
        value=0,
    ).transact()
    assert not tx_execution_succeeded(tx_receipt)


def test_create_will_rejects_malformed_wallet_address(willchain_contract):
    beneficiaries = json.dumps(
        [{"wallet": "not-a-real-address", "share_pct": 100, "condition": ""}]
    )
    tx_receipt = willchain_contract.create_will(
        args=[
            "will-bad-address",
            "Someone",
            "1970-01-01",
            "US",
            "Miami",
            beneficiaries,
            "Everything to whoever that is.",
            "",
        ],
        value=0,
    ).transact()
    assert not tx_execution_succeeded(tx_receipt), (
        "a malformed beneficiary address should be rejected at creation time, "
        "not discovered later during distribution"
    )


def test_file_death_claim_requires_min_evidence(willchain_contract):
    _create_simple_will(willchain_contract, "will-002")
    tx_receipt = willchain_contract.file_death_claim(
        args=["will-002", ["https://example.org/only-one-source"]]
    ).transact()
    assert not tx_execution_succeeded(tx_receipt), (
        "file_death_claim must reject fewer than 2 evidence sources"
    )


def test_file_death_claim_rejects_on_nonactive_will(willchain_contract):
    _create_simple_will(willchain_contract, "will-003")
    revoke_receipt = willchain_contract.revoke_will(args=["will-003"]).transact()
    assert tx_execution_succeeded(revoke_receipt)

    tx_receipt = willchain_contract.file_death_claim(
        args=[
            "will-003",
            ["https://example.org/evidence-1", "https://example.org/evidence-2"],
        ]
    ).transact()
    assert not tx_execution_succeeded(tx_receipt), (
        "file_death_claim must reject a will that is no longer active (revoked here)"
    )


def test_revoke_will_by_creator(willchain_contract):
    _create_simple_will(willchain_contract, "will-004")
    tx_receipt = willchain_contract.revoke_will(args=["will-004"]).transact()
    assert tx_execution_succeeded(tx_receipt)

    raw = willchain_contract.get_will(args=["will-004"]).call()
    will = json.loads(raw)
    assert will["status"] == "revoked"
    assert will["escrow_total"] == 0


def test_cosign_execution_rejects_when_nothing_pending(willchain_contract):
    """cosign_execution should only ever be callable by the configured
    cosigner, and only while a will is actually pending_execution. We can't
    easily impersonate a second account without a fixture for one in every
    gltest version, so this test instead checks the simpler, always-true
    invariant: calling cosign_execution on a will that has no pending
    execution and no cosigner configured must fail."""
    _create_simple_will(willchain_contract, "will-005")
    tx_receipt = willchain_contract.cosign_execution(args=["will-005"]).transact()
    assert not tx_execution_succeeded(tx_receipt), (
        "cosign_execution must fail: this will has no pending execution and no cosigner"
    )


def test_contest_execution_rejects_unrelated_caller_state(willchain_contract):
    """A will that is still 'active' (nothing pending/executed yet) must
    reject contest_execution outright."""
    _create_simple_will(willchain_contract, "will-006")
    tx_receipt = willchain_contract.contest_execution(
        args=["will-006", ["https://example.org/dispute-evidence"]]
    ).transact()
    assert not tx_execution_succeeded(tx_receipt), (
        "contest_execution must reject a will with nothing pending/executed"
    )


def test_resolve_contest_rejects_when_not_contested(willchain_contract):
    _create_simple_will(willchain_contract, "will-007")
    tx_receipt = willchain_contract.resolve_contest(
        args=["will-007", ["https://example.org/fresh-evidence-1", "https://example.org/fresh-evidence-2"]]
    ).transact()
    assert not tx_execution_succeeded(tx_receipt), (
        "resolve_contest must reject a will that isn't currently under contest"
    )


def test_get_will_rejects_unknown_id(willchain_contract):
    with pytest.raises(Exception):
        willchain_contract.get_will(args=["no-such-will"]).call()


# ---------------------------------------------------------------------------
# Non-deterministic tests (real web fetch + real LLM call via validators)
# ---------------------------------------------------------------------------

@pytest.mark.slow
def test_file_death_claim_end_to_end(willchain_contract):
    """This test performs a *real* non-deterministic death check against
    live evidence URLs and therefore depends on external content and LLM
    behaviour. Skipped by default; run explicitly with:
        RUN_SLOW_WILLCHAIN_TESTS=1 gltest -m slow test/test_willchain.py
    Replace the URLs below with stable evidence pages relevant to your own
    test scenario before enabling this."""
    import os

    if not os.environ.get("RUN_SLOW_WILLCHAIN_TESTS"):
        pytest.skip("set RUN_SLOW_WILLCHAIN_TESTS=1 to run live LLM/web tests")

    _create_simple_will(willchain_contract, "will-e2e")
    tx_receipt = willchain_contract.file_death_claim(
        args=[
            "will-e2e",
            ["https://example.org/evidence-1", "https://example.org/evidence-2"],
        ]
    ).transact()
    assert tx_execution_succeeded(tx_receipt)

    raw = willchain_contract.get_will(args=["will-e2e"]).call()
    will = json.loads(raw)
    assert will["status"] in ("active", "pending_execution", "executed")
