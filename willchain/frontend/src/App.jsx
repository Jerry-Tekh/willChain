import React, { useEffect, useState } from "react";
import { readWillChain, writeWillChain, appealTransaction, CONTRACT_ADDRESS, CHAIN_LABEL } from "./genlayerClient.js";

function useWillIds() {
  const [ids, setIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await readWillChain("list_will_ids");
      setIds(result || []);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return { ids, loading, error, refresh };
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

function CreateWillForm({ onCreated }) {
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
      const totalPct = beneficiaries.reduce((s, b) => s + Number(b.share_pct || 0), 0);
      if (totalPct !== 100) {
        throw new Error(`Beneficiary shares must sum to 100 (currently ${totalPct}).`);
      }
      await writeWillChain(
        "create_will",
        [
          form.willId,
          form.name,
          form.dob,
          form.nationality,
          form.city,
          JSON.stringify(beneficiaries),
          form.narrative,
          form.cosigner,
        ],
        Math.round(Number(form.escrow || 0))
      );
      setStatus({ ok: true, msg: `Will "${form.willId}" created.` });
      setForm(emptyForm);
      setBeneficiaries(emptyBeneficiaries);
      onCreated?.();
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

export default function App() {
  const { ids, loading, error, refresh } = useWillIds();
  const [selected, setSelected] = useState(null);

  return (
    <div className="app">
      <header>
        <h1>WillChain</h1>
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
          <CreateWillForm onCreated={refresh} />
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
