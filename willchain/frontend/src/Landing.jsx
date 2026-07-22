import React from "react";

/**
 * Marketing landing page shown before the dApp. `onOpen` switches the SPA to
 * the app view. Design is inspired by willchain.org: a hero, feature trio,
 * protocol-feature grid, a "how it works" flow, and a closing CTA.
 */
export default function Landing({ onOpen, chainLabel }) {
  return (
    <div className="landing">
      {/* Nav */}
      <nav className="lp-nav">
        <a className="lp-brand" href="#top">
          <span className="lp-logo" aria-hidden="true">◈</span>
          AetherWill
        </a>
        <div className="lp-nav-links">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#faq">FAQ</a>
        </div>
        <button className="btn btn-primary lp-nav-cta" onClick={onOpen}>
          Open App
        </button>
      </nav>

      {/* Hero */}
      <header className="lp-hero" id="top">
        <div className="lp-hero-content">
          <span className="lp-pill">Built on GenLayer · AI-executed on-chain</span>
          <h1 className="lp-title">
            The future of digital <span className="lp-grad">estate planning</span>
          </h1>
          <p className="lp-subtitle">
            Encode your will in plain English. When independent public evidence
            confirms a passing, AetherWill’s intelligent contract verifies it with
            AI consensus and distributes your on-chain assets — automatically,
            privately, and without a middleman.
          </p>
          <div className="lp-hero-cta">
            <button className="btn btn-primary btn-lg" onClick={onOpen}>
              Open App →
            </button>
            <a
              className="btn btn-ghost btn-lg"
              href="#how"
            >
              See how it works
            </a>
          </div>
          <p className="lp-hero-meta">
            No subscriptions. No setup fees. Non-custodial. Live on {chainLabel}.
          </p>
        </div>

        <div className="lp-hero-visual" aria-hidden="true">
          <div className="lp-orb" />
          <div className="lp-card-float lp-card-1">
            <div className="lp-cf-title">Will · sarah-estate</div>
            <div className="lp-cf-row"><span>Status</span><b className="ok">active</b></div>
            <div className="lp-cf-row"><span>Beneficiaries</span><b>3</b></div>
            <div className="lp-cf-row"><span>Escrow</span><b>locked</b></div>
          </div>
          <div className="lp-card-float lp-card-2">
            <div className="lp-cf-title">AI verification</div>
            <div className="lp-cf-row"><span>death_confirmed</span><b className="ok">true</b></div>
            <div className="lp-cf-row"><span>confidence</span><b>high</b></div>
          </div>
        </div>
      </header>

      {/* Feature trio */}
      <section className="lp-section" id="features">
        <h2 className="lp-h2">Why AetherWill</h2>
        <p className="lp-lead">
          A decentralized protocol for privacy-preserving, self-executing digital wills.
        </p>
        <div className="lp-grid-3">
          {[
            {
              icon: "🔒",
              title: "Secure inheritance planning",
              body:
                "Assets are held in escrow by the contract itself and released only when death is confirmed — no custodian ever holds your keys.",
            },
            {
              icon: "⚡",
              title: "Self-executing & private",
              body:
                "AI validators reach consensus on the evidence, then the contract distributes funds on its own. Only structured results go on-chain.",
            },
            {
              icon: "🌐",
              title: "Programmatic wealth transfer",
              body:
                "Split shares by percentage, attach plain-English conditions, and add an optional human co-signer for large estates.",
            },
          ].map((f) => (
            <div className="lp-feature" key={f.title}>
              <div className="lp-feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Protocol features grid */}
      <section className="lp-section lp-section-alt">
        <h2 className="lp-h2">Protocol features</h2>
        <div className="lp-grid-2">
          {[
            ["Self-executing & claimable", "The contract pays beneficiaries the moment death is confirmed."],
            ["Privacy preserving", "Only booleans and enums reach the chain — never your evidence text."],
            ["AI death verification", "Multiple validators independently assess public evidence and must agree."],
            ["Non-custodial & flexible", "You keep control until execution; revoke any active will anytime."],
            ["Conditional bequests", "Attach conditions like “if over 18”, evaluated at execution time."],
            ["No fees, ever", "AetherWill will never charge subscriptions or setup fees."],
          ].map(([t, b]) => (
            <div className="lp-mini" key={t}>
              <div className="lp-check" aria-hidden="true">✓</div>
              <div>
                <h4>{t}</h4>
                <p>{b}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="lp-section" id="how">
        <h2 className="lp-h2">How it works</h2>
        <div className="lp-steps">
          {[
            ["01", "Create a will", "Describe your wishes in plain English, add beneficiaries and shares, and lock escrow."],
            ["02", "Evidence is filed", "Anyone can file a death claim with independent, public evidence URLs."],
            ["03", "AI reaches consensus", "GenLayer validators verify the evidence and must agree on a high-confidence result."],
            ["04", "Assets distribute", "The contract releases escrow to beneficiaries automatically — or pauses for a co-signer."],
          ].map(([n, t, b]) => (
            <div className="lp-step" key={n}>
              <div className="lp-step-num">{n}</div>
              <h3>{t}</h3>
              <p>{b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Closing CTA */}
      <section className="lp-cta" id="faq">
        <div className="lp-cta-inner">
          <h2>Begin your journey with AetherWill</h2>
          <p>
            Connect a wallet on {chainLabel} and create your first on-chain will
            in minutes. Not legal advice — a technical execution layer for assets
            you already control.
          </p>
          <button className="btn btn-primary btn-lg" onClick={onOpen}>
            Open App →
          </button>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-brand">
          <span className="lp-logo" aria-hidden="true">◈</span> AetherWill
        </div>
        <p className="muted">
          AI-executed on-chain estate management, built on GenLayer. © {" "}
          {"2026"} AetherWill. Not legal advice.
        </p>
      </footer>
    </div>
  );
}
