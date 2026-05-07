export function VirusIntelCard() {
  return (
    <section className="virus-card" aria-label="Target pathogen profile">
      <div className="virus-card-hd">
        <span className="virus-card-title">PATHOGEN PROFILE</span>
      </div>
      <div className="virus-card-body">
        <div className="virus-microscope" aria-hidden="true">
          <svg viewBox="0 0 120 120" className="virus-svg">
            <defs>
              <linearGradient id="vm-glass" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#00c8ff" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#00ff9d" stopOpacity="0.15" />
              </linearGradient>
            </defs>
            <rect x="8" y="8" width="104" height="104" rx="6" fill="#0c1829" stroke="#1e3a5f" />
            <ellipse cx="62" cy="54" rx="38" ry="26" fill="url(#vm-glass)" stroke="#00c8ff" strokeWidth="1.2" />
            <line x1="62" y1="28" x2="62" y2="14" stroke="#00ff9d" strokeWidth="2" />
            <rect x="54" y="10" width="16" height="10" rx="2" fill="#112236" stroke="#00c8ff" />
            <line x1="62" y1="80" x2="62" y2="98" stroke="#00c8ff" strokeWidth="2" />
            <rect x="42" y="96" width="40" height="10" rx="2" fill="#112236" stroke="#1e3a5f" />
            <circle cx="62" cy="54" r="10" fill="none" stroke="#ffa726" strokeWidth="1.5" opacity="0.85" />
            <circle cx="62" cy="54" r="4" fill="#ffa726" opacity="0.35" />
            <path d="M26 88 L94 88" stroke="#1e3a5f" strokeDasharray="3 4" />
            <text x="62" y="106" textAnchor="middle" fill="#6a9cc0" fontSize="7" fontFamily="JetBrains Mono, monospace">
              schematic
            </text>
          </svg>
        </div>
        <div className="virus-copy">
          <p className="virus-name">Orthohantavirus · zoonotic bunyavirus</p>
          <p className="virus-fine">
            Enveloped, negative-sense tri-segmented RNA (family <strong>Hantaviridae</strong>). Rodent reservoirs; humans typically infected via
            aerosolized rodent excreta. Some South American genotypes (e.g. Andes lineage) have
            rare person-to-person transmission documented in outbreak settings.
          </p>
          <p className="virus-fine virus-dim">
            HCPS/HPS presents as non-specific prodrome → rapid respiratory compromise; HFRS
            renal syndromes occur with other species globally. Your dots below are <em>signal tiers</em>, not clinical diagnoses.
          </p>
        </div>
      </div>
    </section>
  )
}
