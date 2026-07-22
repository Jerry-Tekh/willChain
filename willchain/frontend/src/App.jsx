import React, { useEffect, useState } from "react";
import Landing from "./Landing.jsx";
import {
  readWillChain,
  writeWillChain,
  appealTransaction,
  CONTRACT_ADDRESS,
  CHAIN_LABEL,
  hasInjectedWallet,
  getConnectedAddress,
  connectWallet,
} from "./genlayerClient.js";

function shortAddr(a) {
  return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : "";
}

/**
 * Wallet connection status + button. Three states:
 *  - no injected wallet: link to MetaMask, app falls back to a burner account
 *  - wallet present, not connected: "Connect Wallet" button (MetaMask prompt)
 *  - connected: shows the short address
 */
function WalletButton() {
  const [address, setAddress] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Silent check on load — does NOT pop the MetaMask dialog.
    getConnectedAddress().then(setAddress);
    // Track account switches / disconnects made from the wallet UI itself.
    if (hasInjectedWallet() && window.ethereum.on) {
      const onAccounts = (accounts) => setAddress(accounts?.[0] || null);
      window.ethereum.on("accountsChanged", onAccounts);
      return () => window.ethereum.removeListener?.("accountsChanged", onAccounts);
    }
  }, []);

  if (!hasInjectedWallet()) {
    return (
      <span className="wallet wallet-none" title="Using a temporary in-browser account. Install MetaMask to use your own.">
        no wallet — demo account{" "}
        <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">
          get MetaMask
        </a>
      </span>
    );
  }

  if (address) {
    return (
      <span className="wallet wallet-connected" title={address}>
        ● {shortAddr(address)}
      </span>
    );
  }

  return (
    <span className="wallet">
      <button
        className="primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            setAddress(await connectWallet());
          } catch (e) {
            setError(String(e.message || e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Connecting..." : "Connect Wallet"}
      </button>
      {error && <span className="err"> {error}</span>}
    </span>
  );
}

function useWillIds() {
  const [ids, setIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // will_ids created this session, shown immediately even if the on-chain read
  // hasn't caught up yet. Merged with the chain result and reconciled on refresh.
  const [optimistic, setOptimistic] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem("willchain:recentIds") || "[]");
    } catch {
      return [];
    }
  });

  const addOptimistic = (id) => {
    if (!id) return;
    setOptimistic((prev) => {
      const next = prev.includes(id) ? prev : [...prev, id];
      try {
        window.localStorage.setItem("willchain:recentIds", JSON.stringify(next));
      } catch {
        // ignore storage failures
      }
      return next;
    });
  };

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = (await readWillChain("list_will_ids")) || [];
      setIds(result);
      // Drop optimistic ids the chain now confirms, so the list de-dupes.
      setOptimistic((prev) => {
        const next = prev.filter((id) => !result.includes(id));
        try {
          window.localStorage.setItem("willchain:recentIds", JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  // De-duplicated union: confirmed on-chain ids first, then any pending ones.
  const merged = [...ids, ...optimistic.filter((id) => !ids.includes(id))];
  return { ids: merged, loading, error, refresh, addOptimistic };
}

function Banner() {
  if (CONTRACT_ADDRESS) return null;
  return (
    <div className="banner">
      No contract address configured. Deploy the contract (see README), then
      set <code>VITE_WILLCHAIN_CONTRACT_ADDRESS</code> in{" "}
      <code>frontend/.env</code> and restart <code>npm run dev</code>.
    </div>
  );
}

function CreateWillForm({ onCreated, existingIds }) {
  const emptyForm = {
    willId: "",
    name: "",
    dob: "",
    nationality: "",
    city: "",
    narrative: "",
    cosigner: "",
    escrow: "0",
  };
  const emptyBeneficiaries = [{ wallet: "", share_pct: 100, condition: "" }];

  const [form, setForm] = useState(emptyForm);
  const [beneficiaries, setBeneficiaries] = useState(emptyBeneficiaries);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  const updateBeneficiary = (i, field, value) => {
    const next = [...beneficiaries];
    next[i] = {
      ...next[i],
      [field]: field === "share_pct" ? Math.round(Number(value) || 0) : value,
    };
    setBeneficiaries(next);
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      // Pre-flight validation mirroring the contract's own asserts, so the
      // user gets a specific reason BEFORE spending gas — the GenVM only
      // returns a bare "FINISHED_WITH_ERROR" (exit code 1) on a failed assert,
      // with no message, so validating here is the only way to be specific.
      const willId = form.willId.trim();
      if (!willId) {
        throw new Error("Will ID cannot be empty.");
      }
      if (existingIds?.some((id) => id === willId)) {
        throw new Error(
          `Will ID "${willId}" already exists. Every will needs a unique ID — try another (e.g. "${willId}-2").`
        );
      }

      const cleaned = beneficiaries
        .map((b) => ({
          wallet: (b.wallet || "").trim(),
          share_pct: Math.round(Number(b.share_pct) || 0),
          condition: (b.condition || "").trim(),
        }))
        .filter((b) => b.wallet || b.share_pct); // drop fully-empty rows

      if (cleaned.length === 0) {
        throw new Error("Add at least one beneficiary with a wallet and share.");
      }
      const seen = new Set();
      for (const b of cleaned) {
        if (!b.wallet) {
          throw new Error("Every beneficiary needs a wallet address.");
        }
        if (!/^0x[0-9a-fA-F]{40}$/.test(b.wallet)) {
          throw new Error(`"${b.wallet}" is not a valid 0x… wallet address.`);
        }
        const norm = b.wallet.toLowerCase();
        if (seen.has(norm)) {
          throw new Error(`Duplicate beneficiary wallet: ${b.wallet}`);
        }
        seen.add(norm);
        if (!(b.share_pct > 0 && b.share_pct <= 100)) {
          throw new Error(
            `Each share must be a whole number between 1 and 100 (got ${b.share_pct}).`
          );
        }
      }
      const totalPct = cleaned.reduce((s, b) => s + b.share_pct, 0);
      if (totalPct !== 100) {
        throw new Error(`Beneficiary shares must sum to 100 (currently ${totalPct}).`);
      }
      if (form.cosigner && !/^0x[0-9a-fA-F]{40}$/.test(form.cosigner.trim())) {
        throw new Error("Cosigner must be a valid 0x… address, or left blank.");
      }

      await writeWillChain(
        "create_will",
        [
          willId,
          form.name,
          form.dob,
          form.nationality,
          form.city,
          JSON.stringify(cleaned),
          form.narrative,
          form.cosigner.trim(),
        ],
        Math.round(Number(form.escrow || 0))
      );
      setStatus({ ok: true, msg: `Will "${willId}" created.` });
      setForm(emptyForm);
      setBeneficiaries(emptyBeneficiaries);
      onCreated?.(willId);
    } catch (e) {
      setStatus({ ok: false, msg: String(e.message || e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      <h2>Create a will</h2>

      <label>Will ID</label>
      <input
        required
        placeholder="will-001"
        value={form.willId}
        onChange={(e) => setForm({ ...form, willId: e.target.value })}
      />

      <div className="grid2">
        <div>
          <label>Testator full name</label>
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div>
          <label>Date of birth</label>
          <input
            required
            type="date"
            value={form.dob}
            onChange={(e) => setForm({ ...form, dob: e.target.value })}
          />
        </div>
        <div>
          <label>Nationality</label>
          <input
            required
            value={form.nationality}
            onChange={(e) => setForm({ ...form, nationality: e.target.value })}
          />
        </div>
        <div>
          <label>City of residence</label>
          <input
            required
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
          />
        </div>
      </div>

      <label>Will narrative (plain English)</label>
      <textarea
        required
        rows={3}
        placeholder="I leave 60% to my daughter Sarah and 40% to my son Mark, provided he is over 18."
        value={form.narrative}
        onChange={(e) => setForm({ ...form, narrative: e.target.value })}
      />

      <label>Beneficiaries</label>
      {beneficiaries.map((b, i) => (
        <div className="grid3" key={i}>
          <input
            placeholder="wallet address (0x...)"
            value={b.wallet}
            onChange={(e) => updateBeneficiary(i, "wallet", e.target.value)}
          />
          <input
            type="number"
            min="1"
            max="100"
            placeholder="share %"
            value={b.share_pct}
            onChange={(e) => updateBeneficiary(i, "share_pct", e.target.value)}
          />
          <input
            placeholder="condition (optional)"
            value={b.condition}
            onChange={(e) => updateBeneficiary(i, "condition", e.target.value)}
          />
        </div>
      ))}
      <div className="row">
        <button
          type="button"
          onClick={() =>
            setBeneficiaries([...beneficiaries, { wallet: "", share_pct: 0, condition: "" }])
          }
        >
          + Add beneficiary
        </button>
        {beneficiaries.length > 1 && (
          <button type="button" onClick={() => setBeneficiaries(beneficiaries.slice(0, -1))}>
            − Remove last
          </button>
        )}
      </div>

      <div className="grid2">
        <div>
          <label>Optional cosigner / trustee address</label>
          <input
            placeholder="leave blank for none"
            value={form.cosigner}
            onChange={(e) => setForm({ ...form, cosigner: e.target.value })}
          />
        </div>
        <div>
          <label>Escrow amount (whole-number, smallest on-chain unit — not a decimal GEN display value)</label>
          <input
            type="number"
            min="0"
            step="1"
            value={form.escrow}
            onChange={(e) => setForm({ ...form, escrow: e.target.value })}
          />
        </div>
      </div>

      <button className="primary" type="submit" disabled={busy}>
        {busy ? "Submitting..." : "Create will"}
      </button>
      {status && <p className={status.ok ? "ok" : "err"}>{status.msg}</p>}
    </form>
  );
}

function WillDetail({ willId, onChanged }) {
  const [will, setWill] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [evidenceUrls, setEvidenceUrls] = useState(["", ""]);
  const [disputeEvidenceUrls, setDisputeEvidenceUrls] = useState([""]);
  const [reverifyUrls, setReverifyUrls] = useState(["", ""]);
  const [deathClaimTxHash, setDeathClaimTxHash] = useState(() => {
    try {
      return window.localStorage.getItem(`willchain:deathClaimTx:${willId}`);
    } catch {
      return null;
    }
  });

  const rememberDeathClaimTx = (hash) => {
    setDeathClaimTxHash(hash);
    try {
      window.localStorage.setItem(`willchain:deathClaimTx:${willId}`, hash);
    } catch {
      // localStorage unavailable (private browsing etc.) — in-memory only for this session
    }
  };

  const load = async () => {
    setError(null);
    try {
      const raw = await readWillChain("get_will", [willId]);
      setWill(JSON.parse(raw));
    } catch (e) {
      setError(String(e.message || e));
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [willId]);

  const run = async (label, fn, { isDeathClaim = false } = {}) => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await fn();
      if (isDeathClaim && result?.hash) {
        rememberDeathClaimTx(result.hash);
      }
      setStatus({ ok: true, msg: `${label} succeeded.` });
      await load();
      onChanged?.();
    } catch (e) {
      setStatus({ ok: false, msg: `${label} failed: ${e.message || e}` });
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="err">{error}</p>;
  if (!will) return <p>Loading...</p>;

  return (
    <div className="card">
      <h2>{willId}</h2>
      <p>
        <strong>Status:</strong> {will.status}{" "}
        {will.death_confirmed && <span className="tag">death confirmed</span>}
      </p>
      <p>
        <strong>Testator:</strong> {will.testator.name} ({will.testator.dob},{" "}
        {will.testator.nationality}, {will.testator.city})
      </p>
      <p>
        <strong>Narrative:</strong> {will.narrative}
      </p>
      <p>
        <strong>Escrowed:</strong> {will.escrow_total} (smallest on-chain unit)
      </p>
      <ul>
        {will.beneficiaries.map((b, i) => (
          <li key={i}>
            {b.wallet} — {b.share_pct}%{b.condition ? ` (if: ${b.condition})` : ""}
          </li>
        ))}
      </ul>
      {will.last_claim_result && (
        <p className="muted">
          Last claim result: {JSON.stringify(will.last_claim_result)}
        </p>
      )}
      {will.cosigner && (
        <p>
          <strong>Cosigner:</strong> {will.cosigner} —{" "}
          {will.cosigned ? "signed" : "awaiting signature"}
        </p>
      )}

      <hr />

      {will.status === "revoked" && (
        <p className="muted">
          This will was revoked by its creator before any death claim was
          confirmed. Its escrowed funds (if any) were returned to the
          creator at the time of revocation.
        </p>
      )}

      {will.status === "active" && (
        <>
          <h3>File a death claim</h3>
          <p className="muted">Provide at least 2 independent evidence URLs.</p>
          {evidenceUrls.map((u, i) => (
            <input
              key={i}
              placeholder={`evidence URL #${i + 1}`}
              value={u}
              onChange={(e) => {
                const next = [...evidenceUrls];
                next[i] = e.target.value;
                setEvidenceUrls(next);
              }}
            />
          ))}
          <div className="row">
            <button type="button" onClick={() => setEvidenceUrls([...evidenceUrls, ""])}>
              + Add source
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                run(
                  "File death claim",
                  () =>
                    writeWillChain("file_death_claim", [
                      willId,
                      evidenceUrls.filter(Boolean),
                    ]),
                  { isDeathClaim: true }
                )
              }
            >
              Submit death claim
            </button>
          </div>
          <button
            disabled={busy}
            onClick={() => run("Revoke will", () => writeWillChain("revoke_will", [willId]))}
          >
            Revoke will (creator only)
          </button>
        </>
      )}

      {will.status === "pending_execution" && will.cosigner && !will.cosigned && (
        <button
          className="primary"
          disabled={busy}
          onClick={() => run("Cosign execution", () => writeWillChain("cosign_execution", [willId]))}
        >
          Cosign & release funds (trustee only)
        </button>
      )}

      {(will.status === "pending_execution" || will.status === "executed") && (
        <>
          <h3>Disputes</h3>
          {deathClaimTxHash && (
            <>
              <p className="muted">
                To contest the decision <em>before</em> it finalizes, appeal the
                original death-confirmation transaction:
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  run("Appeal transaction", () => appealTransaction(deathClaimTxHash))
                }
              >
                Appeal death-confirmation tx ({deathClaimTxHash.slice(0, 10)}...)
              </button>
            </>
          )}
          <p className="muted">
            After finality (or if you don't have the tx hash), file a formal
            application-level dispute instead:
          </p>
          {disputeEvidenceUrls.map((u, i) => (
            <input
              key={i}
              placeholder={`dispute evidence URL #${i + 1}`}
              value={u}
              onChange={(e) => {
                const next = [...disputeEvidenceUrls];
                next[i] = e.target.value;
                setDisputeEvidenceUrls(next);
              }}
            />
          ))}
          <div className="row">
            <button type="button" onClick={() => setDisputeEvidenceUrls([...disputeEvidenceUrls, ""])}>
              + Add evidence
            </button>
            <button
              disabled={busy}
              onClick={() =>
                run("Contest execution", () =>
                  writeWillChain("contest_execution", [
                    willId,
                    disputeEvidenceUrls.filter(Boolean),
                  ])
                )
              }
            >
              File formal dispute
            </button>
          </div>
        </>
      )}

      {will.status === "executed_disputed" && (
        <>
          <h3>Disputed (already executed)</h3>
          <p className="muted">
            This will's funds were already distributed before a dispute was
            filed against it. The contract cannot claw back or re-run a
            distribution that already happened — this status exists purely
            as an on-chain record that someone contested the outcome.
            Resolving this further is an off-chain / legal matter.
          </p>
          {will.contest_evidence && will.contest_evidence.length > 0 && (
            <ul>
              {will.contest_evidence.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {will.status === "contested" && (
        <>
          <h3>Resolve contest</h3>
          <p className="muted">
            This forwards to the same death-verification logic as filing a
            death claim, so it needs at least 2 independent evidence URLs.
          </p>
          {reverifyUrls.map((u, i) => (
            <input
              key={i}
              placeholder={`fresh evidence URL #${i + 1}`}
              value={u}
              onChange={(e) => {
                const next = [...reverifyUrls];
                next[i] = e.target.value;
                setReverifyUrls(next);
              }}
            />
          ))}
          <div className="row">
            <button type="button" onClick={() => setReverifyUrls([...reverifyUrls, ""])}>
              + Add source
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                run(
                  "Resolve contest",
                  () =>
                    writeWillChain("resolve_contest", [willId, reverifyUrls.filter(Boolean)]),
                  { isDeathClaim: true }
                )
              }
            >
              Re-run death verification
            </button>
          </div>
        </>
      )}

      {status && <p className={status.ok ? "ok" : "err"}>{status.msg}</p>}
    </div>
  );
}

function WillApp({ onHome }) {
  const { ids, loading, error, refresh, addOptimistic } = useWillIds();
  const [selected, setSelected] = useState(null);

  // After a create: show the new id immediately, then refresh a few times to
  // let the on-chain list catch up (a just-accepted write can lag a read).
  const handleCreated = (newId) => {
    if (newId) {
      addOptimistic(newId);
      setSelected(newId);
    }
    refresh();
    setTimeout(refresh, 4000);
    setTimeout(refresh, 12000);
  };

  return (
    <div className="app">
      <header>
        <div className="header-top">
          <button className="brand-btn" onClick={onHome} aria-label="Back to home">
            <span className="lp-logo" aria-hidden="true">◈</span>
            <h1>WillChain</h1>
          </button>
          <WalletButton />
        </div>
        <p className="muted">
          AI-executed on-chain estate management, built on GenLayer.{" "}
          <span className="network-badge">network: {CHAIN_LABEL}</span>
        </p>
      </header>

      <Banner />

      <main>
        <section>
          <div className="card">
            <h2>Wills</h2>
            {loading && <p>Loading...</p>}
            {error && <p className="err">{error}</p>}
            <ul className="will-list">
              {ids.map((id) => (
                <li key={id}>
                  <button className={selected === id ? "selected" : ""} onClick={() => setSelected(id)}>
                    {id}
                  </button>
                </li>
              ))}
              {ids.length === 0 && !loading && <p className="muted">No wills yet.</p>}
            </ul>
            <button onClick={refresh}>Refresh</button>
          </div>

          {selected && <WillDetail key={selected} willId={selected} onChanged={refresh} />}
        </section>

        <section>
          <CreateWillForm onCreated={handleCreated} existingIds={ids} />
        </section>
      </main>

      <footer className="muted">
        <p>
          WillChain is a technical execution layer, not a substitute for legal
          advice. Its legal validity as a will varies by jurisdiction — see
          README "Legal &amp; privacy considerations".
        </p>
      </footer>
    </div>
  );
}

export default function App() {
  // Simple two-view SPA: marketing landing -> dApp. Remembering the choice in
  // sessionStorage keeps the user on the app across a refresh within a session.
  const [view, setView] = useState(() => {
    try {
      return window.sessionStorage.getItem("willchain:view") === "app" ? "app" : "landing";
    } catch {
      return "landing";
    }
  });

  const go = (v) => {
    setView(v);
    try {
      window.sessionStorage.setItem("willchain:view", v);
    } catch {
      // sessionStorage unavailable — in-memory only
    }
    window.scrollTo(0, 0);
  };

  if (view === "landing") {
    return <Landing onOpen={() => go("app")} chainLabel={CHAIN_LABEL} />;
  }
  return <WillApp onHome={() => go("landing")} />;
}
