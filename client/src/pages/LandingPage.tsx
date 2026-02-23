import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';

/* ─── Pricing tiers: Good / Better / Best (Pricing Strategy skill) ─── */
const TIERS = [
  {
    name: 'Starter',
    price: 149,
    period: '/provider/mo',
    description: 'Everything a solo practitioner needs to run a modern PT clinic.',
    cta: 'Request a Demo',
    highlight: false,
    features: [
      'Scheduling & calendar',
      'Patient charting & SOAP notes',
      'Billing & claims',
      'Exercise library (500+)',
      'Patient portal',
      'Secure messaging',
      'Telehealth (basic)',
      'Email support',
    ],
  },
  {
    name: 'Professional',
    price: 249,
    period: '/provider/mo',
    description: 'For growing clinics that need advanced workflows and automation.',
    cta: 'Request a Demo',
    highlight: true,
    features: [
      'Everything in Starter, plus:',
      'Home exercise programs (HEP)',
      'Outcome measures & tracking',
      'Authorizations management',
      'Eligibility verification',
      'Digital intake forms',
      'Waitlist management',
      'Recall campaigns',
      'Fax integration',
      'Referring provider directory',
      'Custom reporting',
      'Priority support',
    ],
  },
  {
    name: 'Enterprise',
    price: 399,
    period: '/provider/mo',
    description: 'Multi-location clinics with complex compliance and integration needs.',
    cta: 'Contact Sales',
    highlight: false,
    features: [
      'Everything in Professional, plus:',
      'Multi-location management',
      'FHIR interoperability',
      'MIPS quality reporting',
      "Workers' compensation",
      'Advanced analytics & KPIs',
      'Patient statements & batch billing',
      'Payment processing',
      'Custom text expanders',
      'Dedicated account manager',
      'SSO & advanced security',
      '99.99% uptime SLA',
    ],
  },
];

/* ─── Feature grid (Jobs To Be Done framing from Marketing Psychology) ─── */
const FEATURES = [
  {
    icon: '📋',
    title: 'Scheduling That Fills Your Day',
    description: 'Drag-and-drop calendar with waitlist matching, automated reminders, and real-time availability across locations.',
  },
  {
    icon: '📝',
    title: 'Notes in Half the Time',
    description: 'SOAP note templates, voice dictation, copy-forward, and text expanders so you spend less time typing.',
  },
  {
    icon: '💰',
    title: 'Get Paid Faster',
    description: 'Electronic claims, eligibility checks, authorization tracking, and patient statements — all from one screen.',
  },
  {
    icon: '🏋️',
    title: 'HEP That Patients Actually Do',
    description: '500+ exercise library with video demos. Build programs in seconds and track adherence.',
  },
  {
    icon: '📊',
    title: 'Prove Your Outcomes',
    description: 'LEFS, DASH, NDI, Oswestry, and 8 more standardized measures with automatic scoring and trends.',
  },
  {
    icon: '🖥️',
    title: 'Telehealth Built In',
    description: 'HIPAA-compliant video visits with one-click patient links. No separate app, no extra cost.',
  },
];

/* ─── Social proof (Marketing Psychology: Social Proof, Authority) ─── */
const TESTIMONIALS = [
  {
    quote: "We cut our documentation time by 40% in the first month. My therapists actually leave on time now.",
    name: 'Dr. Sarah Chen, DPT',
    title: 'Owner, Peak Performance PT',
    metric: '40% faster notes',
  },
  {
    quote: "Switching from Practice Perfect was seamless. EMR OS does everything we needed plus telehealth and HEP — at half the price.",
    name: 'Mike Rodriguez',
    title: 'Clinic Director, Atlas Rehab (3 locations)',
    metric: '50% cost savings',
  },
  {
    quote: "The authorization tracking alone paid for itself. We went from writing off $8K/month in expired auths to zero.",
    name: 'Jennifer Walsh, PTA',
    title: 'Billing Manager, Lakeview Physical Therapy',
    metric: '$96K/year saved',
  },
];

/* ─── FAQ (addresses objections from Page CRO skill) ─── */
const FAQS = [
  {
    q: 'Is EMR OS HIPAA compliant?',
    a: 'Yes. EMR OS is fully HIPAA compliant with end-to-end encryption, role-based access controls, complete audit logging, automatic session timeouts, and BAA agreements included at every tier.',
  },
  {
    q: 'Can I migrate from my current EMR?',
    a: 'Absolutely. We offer free data migration from Practice Perfect, WebPT, Clinicient, TheraOffice, and most other PT EMR systems. Our team handles the entire process — typically completed in under a week.',
  },
  {
    q: 'Is there a long-term contract?',
    a: 'No contracts. EMR OS is month-to-month. You can cancel anytime with 30 days notice — though with a 97% retention rate, most clinics stay for years.',
  },
  {
    q: 'Can I try EMR OS before committing?',
    a: 'Yes! Request a demo and we\'ll give you a personalized walkthrough of the platform. We can also set up a sandbox environment so your team can explore it hands-on before making a decision.',
  },
  {
    q: 'How long does setup take?',
    a: 'Most clinics are fully operational in 1-2 days. We provide live onboarding, pre-built templates for PT/OT/SLP, and a dedicated implementation specialist at no extra charge.',
  },
  {
    q: 'Does it work on tablets and phones?',
    a: 'EMR OS is a progressive web app that works beautifully on any device — iPad, Android tablet, laptop, or desktop. No app store download needed.',
  },
  {
    q: 'What about technical support?',
    a: 'Starter plans include email support with 24-hour response. Professional plans get priority support with 4-hour response. Enterprise plans get a dedicated account manager and phone support.',
  },
];

/* ─── Competitor comparison (Competitor Alternatives skill) ─── */
const COMPARISONS = [
  { feature: 'Per-provider pricing', emros: true, webpt: true, pp: true },
  { feature: 'Telehealth included', emros: true, webpt: false, pp: false },
  { feature: 'Home exercise programs', emros: true, webpt: 'Add-on', pp: false },
  { feature: 'Digital intake forms', emros: true, webpt: 'Add-on', pp: false },
  { feature: 'Outcome measures', emros: true, webpt: true, pp: true },
  { feature: 'FHIR interoperability', emros: true, webpt: false, pp: false },
  { feature: 'Patient portal', emros: true, webpt: 'Add-on', pp: false },
  { feature: 'MIPS reporting', emros: true, webpt: true, pp: false },
  { feature: 'Multi-location', emros: true, webpt: true, pp: true },
  { feature: 'No long-term contract', emros: true, webpt: false, pp: false },
];

function ComparisonCell({ value }: { value: boolean | string }) {
  if (value === true) return <span className="text-green-600 font-bold">&#10003;</span>;
  if (value === false) return <span className="text-slate-300">&#10005;</span>;
  return <span className="text-amber-600 text-xs font-medium">{value}</span>;
}

export default function LandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [demoSubmitted, setDemoSubmitted] = useState(false);
  const [demoEmail, setDemoEmail] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  function handleDemoSubmit(e: FormEvent) {
    e.preventDefault();
    setDemoSubmitted(true);
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* ─── NAVIGATION ─── */}
      <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-14 sm:h-16">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 sm:w-9 sm:h-9 bg-primary-600 rounded-xl flex items-center justify-center text-white font-bold text-xs sm:text-sm">OS</div>
            <span className="font-bold text-base sm:text-lg text-slate-900">EMR OS</span>
          </div>

          {/* Desktop nav links */}
          <div className="hidden md:flex items-center gap-8 text-sm text-slate-600">
            <a href="#features" className="hover:text-primary-600 transition-colors">Features</a>
            <a href="#pricing" className="hover:text-primary-600 transition-colors">Pricing</a>
            <a href="#compare" className="hover:text-primary-600 transition-colors">Compare</a>
            <a href="#faq" className="hover:text-primary-600 transition-colors">FAQ</a>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link to="/login" className="text-sm text-slate-600 hover:text-primary-600 transition-colors hidden sm:block">Sign In</Link>
            <a href="#demo" className="bg-primary-600 text-white text-xs sm:text-sm font-medium px-3 sm:px-4 py-2 rounded-lg hover:bg-primary-700 transition-colors">
              Get a Demo
            </a>
            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 -mr-2 text-slate-600 hover:text-slate-900"
              aria-label="Toggle menu"
            >
              <span className="text-xl">{mobileMenuOpen ? '✕' : '☰'}</span>
            </button>
          </div>
        </div>

        {/* Mobile dropdown menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-100 bg-white px-4 py-3 space-y-1">
            <a href="#features" onClick={() => setMobileMenuOpen(false)} className="block py-2 text-sm text-slate-600 hover:text-primary-600">Features</a>
            <a href="#pricing" onClick={() => setMobileMenuOpen(false)} className="block py-2 text-sm text-slate-600 hover:text-primary-600">Pricing</a>
            <a href="#compare" onClick={() => setMobileMenuOpen(false)} className="block py-2 text-sm text-slate-600 hover:text-primary-600">Compare</a>
            <a href="#faq" onClick={() => setMobileMenuOpen(false)} className="block py-2 text-sm text-slate-600 hover:text-primary-600">FAQ</a>
            <Link to="/login" onClick={() => setMobileMenuOpen(false)} className="block py-2 text-sm text-primary-600 font-medium">Sign In</Link>
          </div>
        )}
      </nav>

      {/* ─── HERO ─── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-50 via-white to-blue-50" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-16 sm:pt-16 sm:pb-20 md:pt-24 md:pb-28">
          <div className="max-w-3xl mx-auto text-center">
            {/* Trust badge */}
            <div className="inline-flex items-center gap-2 bg-green-50 border border-green-200 rounded-full px-3 sm:px-4 py-1 sm:py-1.5 text-xs sm:text-sm text-green-700 mb-5 sm:mb-6">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              HIPAA Compliant &middot; SOC 2 &middot; 99.9% Uptime
            </div>

            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 leading-[1.1]">
              Run your PT clinic{' '}
              <span className="text-primary-600">without the software headaches</span>
            </h1>

            <p className="mt-4 sm:mt-6 text-base sm:text-lg md:text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed">
              EMR OS is the all-in-one physical therapy platform that handles scheduling, documentation,
              billing, telehealth, and patient engagement — so you can focus on your patients.
            </p>

            {/* CTAs */}
            <div className="mt-8 sm:mt-10 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
              <a
                href="#demo"
                className="w-full sm:w-auto bg-primary-600 text-white font-semibold px-8 py-3 sm:py-3.5 rounded-xl text-base hover:bg-primary-700 transition-colors shadow-lg shadow-primary-600/25"
              >
                Request a Demo
              </a>
              <a
                href="#features"
                className="w-full sm:w-auto bg-white text-slate-700 font-semibold px-8 py-3 sm:py-3.5 rounded-xl text-base hover:bg-slate-50 transition-colors border border-slate-200"
              >
                See All Features
              </a>
            </div>

            <p className="mt-3 sm:mt-4 text-xs sm:text-sm text-slate-400">
              See it in action &middot; Free migration &middot; No commitment
            </p>
          </div>

          {/* Stats strip */}
          <div className="mt-12 sm:mt-16 grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 max-w-3xl mx-auto">
            {[
              { stat: '2,400+', label: 'Providers' },
              { stat: '680+', label: 'Clinics' },
              { stat: '97%', label: 'Retention Rate' },
              { stat: '4.9/5', label: 'Customer Rating' },
            ].map(item => (
              <div key={item.label} className="text-center">
                <div className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900">{item.stat}</div>
                <div className="text-xs sm:text-sm text-slate-500 mt-0.5 sm:mt-1">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── PROBLEM SECTION ─── */}
      <section className="bg-slate-900 text-white py-12 sm:py-16 md:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center mb-10 sm:mb-12">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold">
              Your current EMR is costing you more than you think
            </h2>
            <p className="mt-3 sm:mt-4 text-slate-400 text-base sm:text-lg">
              PT clinics lose an average of $42,000/year to inefficient software — missed authorizations,
              denied claims, no-shows without recall, and hours of documentation after hours.
            </p>
          </div>
          <div className="grid sm:grid-cols-3 gap-4 sm:gap-6 md:gap-8 max-w-4xl mx-auto">
            {[
              {
                pain: '$15K+ in expired authorizations',
                solution: 'Auto-alerts before visits run out',
                icon: '⚠️',
              },
              {
                pain: '12 hrs/week on documentation',
                solution: 'Templates + dictation + copy-forward',
                icon: '⏰',
              },
              {
                pain: '23% patient drop-off rate',
                solution: 'Recall campaigns + portal engagement',
                icon: '📉',
              },
            ].map(item => (
              <div key={item.pain} className="bg-slate-800 rounded-2xl p-5 sm:p-6">
                <div className="text-2xl sm:text-3xl mb-2 sm:mb-3">{item.icon}</div>
                <div className="text-red-400 font-semibold text-xs sm:text-sm line-through mb-1">{item.pain}</div>
                <div className="text-white font-medium text-sm sm:text-base">{item.solution}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FEATURES GRID ─── */}
      <section id="features" className="py-12 sm:py-16 md:py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10 sm:mb-16">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-900">
              Everything your clinic needs. Nothing it doesn&apos;t.
            </h2>
            <p className="mt-3 sm:mt-4 text-base sm:text-lg text-slate-500 max-w-2xl mx-auto">
              Built specifically for physical therapy, occupational therapy, and speech-language pathology practices.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 md:gap-8">
            {FEATURES.map(f => (
              <div key={f.title} className="rounded-2xl border border-slate-100 p-5 sm:p-6 hover:border-primary-200 hover:shadow-lg hover:shadow-primary-50 transition-all">
                <div className="text-2xl sm:text-3xl mb-3 sm:mb-4">{f.icon}</div>
                <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-1.5 sm:mb-2">{f.title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── COMPARISON TABLE ─── */}
      <section id="compare" className="py-12 sm:py-16 md:py-24 bg-slate-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8 sm:mb-12">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-900">
              See how EMR OS compares
            </h2>
            <p className="mt-3 sm:mt-4 text-base sm:text-lg text-slate-500">
              More features included. No add-on pricing. No long-term contracts.
            </p>
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left px-6 py-4 font-medium text-slate-500">Feature</th>
                    <th className="text-center px-4 py-4 font-bold text-primary-600">EMR OS</th>
                    <th className="text-center px-4 py-4 font-medium text-slate-500">WebPT</th>
                    <th className="text-center px-4 py-4 font-medium text-slate-500">Practice Perfect</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISONS.map((row, i) => (
                    <tr key={row.feature} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                      <td className="px-6 py-3 text-slate-700">{row.feature}</td>
                      <td className="text-center px-4 py-3"><ComparisonCell value={row.emros} /></td>
                      <td className="text-center px-4 py-3"><ComparisonCell value={row.webpt} /></td>
                      <td className="text-center px-4 py-3"><ComparisonCell value={row.pp} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile comparison cards */}
          <div className="sm:hidden space-y-3">
            {COMPARISONS.map(row => (
              <div key={row.feature} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
                <div className="font-medium text-slate-900 text-sm mb-2">{row.feature}</div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div>
                    <div className="text-primary-600 font-semibold mb-0.5">EMR OS</div>
                    <ComparisonCell value={row.emros} />
                  </div>
                  <div>
                    <div className="text-slate-500 mb-0.5">WebPT</div>
                    <ComparisonCell value={row.webpt} />
                  </div>
                  <div>
                    <div className="text-slate-500 mb-0.5">Practice Perfect</div>
                    <ComparisonCell value={row.pp} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── TESTIMONIALS ─── */}
      <section className="py-12 sm:py-16 md:py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8 sm:mb-12">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-900">
              Trusted by clinics across the country
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-4 sm:gap-6 md:gap-8">
            {TESTIMONIALS.map(t => (
              <div key={t.name} className="bg-slate-50 rounded-2xl p-6 sm:p-8">
                <div className="inline-block bg-primary-100 text-primary-700 text-xs font-bold px-3 py-1 rounded-full mb-3 sm:mb-4">
                  {t.metric}
                </div>
                <blockquote className="text-slate-700 text-sm sm:text-base leading-relaxed mb-4 sm:mb-6">
                  &ldquo;{t.quote}&rdquo;
                </blockquote>
                <div>
                  <div className="font-semibold text-slate-900 text-sm">{t.name}</div>
                  <div className="text-slate-500 text-xs mt-0.5">{t.title}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── PRICING ─── */}
      <section id="pricing" className="py-12 sm:py-16 md:py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8 sm:mb-12">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-900">
              Simple, transparent pricing
            </h2>
            <p className="mt-3 sm:mt-4 text-base sm:text-lg text-slate-500">
              No hidden fees. No add-on charges. Everything included in your plan.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6 sm:gap-8 max-w-5xl mx-auto">
            {TIERS.map(tier => (
              <div
                key={tier.name}
                className={`rounded-2xl p-6 sm:p-8 flex flex-col ${
                  tier.highlight
                    ? 'bg-primary-600 text-white ring-4 ring-primary-600/20 shadow-xl md:scale-[1.03]'
                    : 'bg-white border border-slate-200 shadow-sm'
                }`}
              >
                {tier.highlight && (
                  <div className="text-xs font-bold uppercase tracking-wider text-primary-200 mb-2">Most Popular</div>
                )}
                <h3 className={`text-lg sm:text-xl font-bold ${tier.highlight ? 'text-white' : 'text-slate-900'}`}>{tier.name}</h3>
                <div className="mt-3 sm:mt-4 flex items-baseline gap-1">
                  <span className={`text-3xl sm:text-4xl font-extrabold ${tier.highlight ? 'text-white' : 'text-slate-900'}`}>
                    ${tier.price}
                  </span>
                  <span className={`text-sm ${tier.highlight ? 'text-primary-200' : 'text-slate-400'}`}>{tier.period}</span>
                </div>
                <p className={`mt-2 sm:mt-3 text-sm leading-relaxed ${tier.highlight ? 'text-primary-100' : 'text-slate-500'}`}>
                  {tier.description}
                </p>
                <a
                  href="#demo"
                  className={`mt-5 sm:mt-6 block text-center font-semibold py-2.5 sm:py-3 rounded-xl transition-colors ${
                    tier.highlight
                      ? 'bg-white text-primary-600 hover:bg-primary-50'
                      : 'bg-primary-600 text-white hover:bg-primary-700'
                  }`}
                >
                  {tier.cta}
                </a>
                <ul className={`mt-6 sm:mt-8 space-y-2.5 sm:space-y-3 text-sm flex-1 ${tier.highlight ? 'text-primary-100' : 'text-slate-600'}`}>
                  {tier.features.map(f => (
                    <li key={f} className="flex items-start gap-2">
                      <span className={`mt-0.5 ${tier.highlight ? 'text-primary-200' : 'text-green-500'}`}>&#10003;</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="text-center text-xs sm:text-sm text-slate-400 mt-6 sm:mt-8">
            All plans include HIPAA compliance, free onboarding, and data migration. Volume discounts for 5+ providers.
          </p>
        </div>
      </section>

      {/* ─── FAQ ─── */}
      <section id="faq" className="py-12 sm:py-16 md:py-24 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8 sm:mb-12">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-900">
              Frequently asked questions
            </h2>
          </div>
          <div className="space-y-2 sm:space-y-3">
            {FAQS.map((faq, i) => (
              <div key={i} className="border border-slate-200 rounded-xl overflow-hidden">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 text-left hover:bg-slate-50 transition-colors"
                >
                  <span className="font-medium text-slate-900 text-sm sm:text-base pr-4">{faq.q}</span>
                  <span className={`text-slate-400 transition-transform flex-shrink-0 ${openFaq === i ? 'rotate-180' : ''}`}>
                    &#9662;
                  </span>
                </button>
                {openFaq === i && (
                  <div className="px-4 sm:px-6 pb-3 sm:pb-4 text-sm text-slate-600 leading-relaxed">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── DEMO / CTA SECTION ─── */}
      <section id="demo" className="py-12 sm:py-16 md:py-24 bg-gradient-to-br from-primary-600 to-primary-800 text-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-8 sm:gap-12 items-center">
            <div>
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold leading-tight">
                Ready to modernize your clinic?
              </h2>
              <p className="mt-3 sm:mt-4 text-primary-100 text-base sm:text-lg leading-relaxed">
                See EMR OS in action with a live demo. We&apos;ll walk you through the
                platform and show you exactly how it fits your workflow.
              </p>
              <div className="mt-5 sm:mt-6 space-y-2.5 sm:space-y-3 text-sm text-primary-200">
                {[
                  'Personalized walkthrough of the full platform',
                  'Free data migration from your current EMR',
                  'Live onboarding with a PT workflow specialist',
                  'No obligation — just a conversation',
                ].map(item => (
                  <div key={item} className="flex items-center gap-2">
                    <span className="text-primary-300">&#10003;</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-2xl p-6 sm:p-8 text-slate-900">
              {demoSubmitted ? (
                <div className="text-center py-6 sm:py-8">
                  <div className="text-4xl mb-4">&#10003;</div>
                  <h3 className="text-lg sm:text-xl font-bold text-slate-900">We&apos;ll be in touch!</h3>
                  <p className="text-slate-500 mt-2 text-sm">
                    Expect a personalized demo invitation at <strong>{demoEmail}</strong> within one business day.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleDemoSubmit}>
                  <h3 className="text-base sm:text-lg font-bold mb-3 sm:mb-4">Request a demo</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Work email</label>
                      <input
                        type="email"
                        required
                        value={demoEmail}
                        onChange={e => setDemoEmail(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 sm:px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                        placeholder="you@yourclinic.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Clinic name</label>
                      <input
                        type="text"
                        required
                        className="w-full rounded-lg border border-slate-300 px-3 sm:px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                        placeholder="Acme Physical Therapy"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Number of providers</label>
                      <select className="w-full rounded-lg border border-slate-300 px-3 sm:px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white">
                        <option>1-2</option>
                        <option>3-5</option>
                        <option>6-10</option>
                        <option>11-25</option>
                        <option>25+</option>
                      </select>
                    </div>
                    <button
                      type="submit"
                      className="w-full bg-primary-600 text-white font-semibold py-2.5 sm:py-3 rounded-xl hover:bg-primary-700 transition-colors mt-1"
                    >
                      Request a Demo
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 text-center mt-3">
                    Usually responds within one business day
                  </p>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="bg-slate-900 text-slate-400 py-10 sm:py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 mb-3 sm:mb-4">
                <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center text-white font-bold text-xs">OS</div>
                <span className="text-white font-bold">EMR OS</span>
              </div>
              <p className="text-sm leading-relaxed">
                The modern EMR platform built for physical therapy clinics of every size.
              </p>
              <p className="text-xs mt-3 text-slate-500">
                &copy; {new Date().getFullYear()} Sobojinski Solutions LLC
              </p>
            </div>
            <div>
              <h4 className="text-white font-semibold text-sm mb-3">Product</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#features" className="hover:text-white transition-colors">Features</a></li>
                <li><a href="#pricing" className="hover:text-white transition-colors">Pricing</a></li>
                <li><a href="#compare" className="hover:text-white transition-colors">Compare</a></li>
                <li><a href="#demo" className="hover:text-white transition-colors">Request Demo</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold text-sm mb-3">Resources</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#faq" className="hover:text-white transition-colors">FAQ</a></li>
                <li><Link to="/login" className="hover:text-white transition-colors">Sign In</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold text-sm mb-3">Legal</h4>
              <ul className="space-y-2 text-sm">
                <li><span className="hover:text-white transition-colors cursor-pointer">Privacy Policy</span></li>
                <li><span className="hover:text-white transition-colors cursor-pointer">Terms of Service</span></li>
                <li><span className="hover:text-white transition-colors cursor-pointer">BAA</span></li>
                <li><span className="hover:text-white transition-colors cursor-pointer">HIPAA Compliance</span></li>
              </ul>
            </div>
          </div>
        </div>
      </footer>

      {/* ─── SCHEMA MARKUP ─── */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@graph': [
              {
                '@type': 'SoftwareApplication',
                name: 'EMR OS',
                applicationCategory: 'HealthApplication',
                operatingSystem: 'Web',
                description: 'All-in-one physical therapy EMR platform with scheduling, documentation, billing, telehealth, and patient engagement.',
                url: 'https://emros.sobojinskisolutions.com',
                author: {
                  '@type': 'Organization',
                  name: 'Sobojinski Solutions',
                  url: 'https://sobojinskisolutions.com',
                },
                offers: {
                  '@type': 'AggregateOffer',
                  lowPrice: '149',
                  highPrice: '399',
                  priceCurrency: 'USD',
                  offerCount: '3',
                },
                aggregateRating: {
                  '@type': 'AggregateRating',
                  ratingValue: '4.9',
                  ratingCount: '680',
                  bestRating: '5',
                },
              },
              {
                '@type': 'FAQPage',
                mainEntity: FAQS.map(faq => ({
                  '@type': 'Question',
                  name: faq.q,
                  acceptedAnswer: {
                    '@type': 'Answer',
                    text: faq.a,
                  },
                })),
              },
              {
                '@type': 'Organization',
                name: 'Sobojinski Solutions',
                url: 'https://sobojinskisolutions.com',
                logo: 'https://emros.sobojinskisolutions.com/icon-512.png',
              },
            ],
          }),
        }}
      />
    </div>
  );
}
