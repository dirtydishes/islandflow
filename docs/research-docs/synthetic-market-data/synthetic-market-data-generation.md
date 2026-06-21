# Synthetic Market Data Generation for Islandflow

## Executive summary and recommendations

A realistic synthetic market-data system for Islandflow should **not** start with historical replay as a hard requirement. For an MVP, the best trade-off is a **hybrid event-driven generator**: regime-switching latent price processes for equities and underlyings; discrete quote/trade emitters with state-dependent spreads, sizes, and venue flags; a light self-exciting burst mechanism for clustered activity; and a separate scenario-injection layer that can override or bias the background stream while preserving deterministic replay. That design matches the core stylized facts seen in real markets—volatility clustering, non-uniform intraday activity, clustered arrival times, discrete ticks, varying spreads, odd lots, off-exchange reporting, and options-chain liquidity concentration—without requiring a single historical sample to ship the first usable version. citeturn1search0turn22view2turn8search1turn7search1turn0search1turn26view1

For the MVP, I would **not** use a full agent-based market simulator, a full synthetic limit-order-book simulator, or generative ML as the primary engine. Those approaches can be powerful, but they are heavier to implement, harder to validate, and either require many behavioral assumptions or enough real data to train and evaluate properly. The literature and industry guidance both point in the same direction: start with transparent, controllable methods, benchmark them hard, and only add more sophistication when you can prove it improves fidelity or test coverage. citeturn21view1turn20view1turn20view2turn20view4turn23view0

The recommended future path is also clear. Once historical data becomes available, add **calibration and replay-plus-mutation** in layers rather than replacing the synthetic engine wholesale. First fit arrival-rate curves, spread states, size mixtures, venue shares, and options-chain activity weights. Then add empirical residual resampling, and only after that consider learned sequence models or learned LOB simulators for the highest-fidelity demo and benchmark streams. That keeps determinism and test intent intact while improving realism step by step. citeturn20view2turn20view4turn23view0

The rest of this report assumes a U.S. consolidated-tape / OPRA-style world with officially documented realities such as TRF-reported off-exchange equity trades, quote/trade correction and cancel messages, late and out-of-sequence conditions, standardized options chain mechanics, and exchange / SIP tick rules. Where I cite practitioner material, I mark it as such in the source notes. citeturn0search4turn0search1turn18search0turn13view5turn24view2turn19search3turn16search6

## What real market data looks like

**Clustered trade arrivals.** Real markets do not produce evenly spaced trades. Order flow clusters because information arrival is uneven, traders split larger intentions into smaller pieces, and activity is self-exciting—one print often increases the chance of nearby prints. This is very important for testing alert thresholds, because a detector that only sees smooth Poisson-like flow will overreact to normal bursts. A simple approximation is a Poisson process with state-dependent intensity. A more realistic approximation is a Hawkes or Hawkes-lite process with a low branching ratio in background mode and higher branching only in injected scenarios. You can ignore it only for tiny unit tests that validate schema or parsing, not alert logic. citeturn22view2turn22view3turn20view1

**Intraday volume curves.** Equity activity is typically higher near the open and close and lower midday; spread and volatility patterns also vary intraday. This matters because a 10:00 a.m. burst and a 1:15 p.m. burst should not be treated as equally surprising. A simple approximation is a deterministic U-shaped multiplier over the day. A more realistic one is a symbol-class-specific curve with random daily deformation and separate curves for trades, quotes, and volatility. You can mostly ignore fine intraday shape in overnight demos, but not in main-session replay or alert validation. citeturn8search1turn8search5turn8search13

**Quiet periods and bursty periods.** Real tapes alternate between lulls and short bursts even within the same broader regime. This is related to clustered arrivals but is worth modeling separately because alert systems often key off rolling-window counts and intensities. A simple approximation is a two-state quiet/busy Markov regime. A more realistic one is a regime-switching point process with self-excitation nested inside the busy state. You can ignore second-order burstiness only if the test objective is pure throughput or serialization. citeturn22view2turn20view1turn6search12

**Uneven trade sizes.** Trade-size distributions are lumpy and heavy-tailed rather than cleanly normal: many small trades, common modal sizes, and a long tail of larger prints. This is important because overly smooth size series make anomaly detectors unrealistically easy. A simple approximation is a mixture of odd lots, round-lot modes, and a Pareto or lognormal tail. A more realistic approximation is state- and venue-dependent mixtures with hidden-order splitting and size autocorrelation. You can ignore the exact tail exponent in the MVP, but not the fact that sizes are heterogeneous and lumpy. citeturn25search0turn25search3turn8search18

**Bid/ask spread variation.** Spreads vary with volatility, time of day, liquidity, and market-maker hedging difficulty. This is crucial for testing because many alert features implicitly treat prints near the ask as aggressive and prints near the bid as bearish; if spreads are unrealistically constant, those features misbehave. A simple approximation is a per-symbol spread state in ticks. A more realistic one makes spread a function of latent volatility, liquidity regime, time of day, and recent quote/trade intensity. You can ignore ultra-fine spread micro-dynamics for low-frequency demos, but not spread state itself. citeturn8search5turn26view0turn26view1

**Quote updates without trades.** Quotes move because liquidity providers revise inventory, respond to public information, or cancel and repost, even if no trade occurs. This matters a lot for replay realism and for preventing detectors from assuming every quote change is confirmation of prior trades. A simple approximation is a quote-update process that runs independently of the trade process but shares the same latent state. A more realistic one includes gap replenishment, cancellation waves, and state-dependent quote intensity. You can ignore it only if your platform never consumes quote streams directly, which is not your use case. citeturn25search22turn20view1turn20view2

**Trades without nearby quote changes.** Many trades do not move the displayed top of book because the resting quote absorbs the trade. That matters because “trade near ask plus unchanged quote” should still be ordinary many times per day in active symbols. A simple approximation is to let small-to-medium prints execute against existing displayed depth without forcing a quote revision. A more realistic approximation tracks visible depth at the top of book and only updates the quote when displayed queue is exhausted or canceled. You can ignore this only in coarse bar-level backtests. citeturn20view1turn13view4turn18search4

**Stale quotes.** Stale or delayed reference prices happen in fragmented markets because of latency, feed differences, and temporary data issues. They are important for false-positive testing because stale quotes can make harmless prints look aggressive. A simple approximation is to occasionally freeze a quote for a deterministic short interval while the latent fair price keeps moving. A more realistic approximation introduces venue-specific or feed-specific latency/staleness. You should not ignore this if your product scores prints relative to NBBO or mid. citeturn9search0turn7search6turn9search23

**Wide quotes.** Real spreads widen during volatility spikes, near opens/closes, in thin contracts, and when hedging becomes risky. This is central to avoiding accidental alert spam, because wide markets create “cheap” ask-lifts and bid-hits that look suspicious if you assume spreads are always tight. A simple approximation is a wider-spread regime with higher quote uncertainty. A more realistic one widens spreads endogenously when latent volatility rises or quote age increases. You can ignore wide markets only for extremely liquid benchmark symbols in happy-path unit tests. citeturn8search5turn26view0turn26view1

**Crossed, locked, and invalid quotes.** U.S. rules generally address locked and crossed quotations, but fleeting locked/crossed states and bad records still matter at the feed-handling edge, especially around timing races, corrections, and invalid records. These are edge cases, not normal background, but they are absolutely worth testing because downstream logic often breaks on them. A simple approximation is rare deterministic injections of locked, crossed, or invalid quote tuples. A more realistic one makes them appear only during feed-latency or quote-alignment fault scenarios. You can ignore them for demo streams, but not for defensive parsers and alert safety. citeturn13view2turn3search11

**Odd lots and round lots.** Odd lots are not noise to be discarded; they are a meaningful and common part of modern U.S. equity trading. That matters because a background stream with only 100-share multiples will look fake fast, and alert thresholds tuned on round-lot-only synthetic data will be brittle. A simple approximation is to let a sizeable minority of trades use sub-round-lot quantities and fractional odd-lot quote sizes where appropriate. A more realistic one makes odd-lot prevalence symbol- and venue-dependent and allows better-priced odd-lot orders than the historical round-lot NBBO framing would imply. You can ignore exact odd-lot prevalence in the MVP, but not odd lots themselves. citeturn25search1turn13view1turn7search5

**Off-exchange and TRF prints.** A large and important share of U.S. equity activity is reported off-exchange through FINRA trade reporting facilities rather than executed on lit exchanges. This matters because flow products that ignore TRF-like prints produce unrealistic venue mixes and miss a major false-positive source. A simple approximation is to assign a controllable percentage of equity trades to off-exchange venue flags with slightly different size and timing behavior. A more realistic one varies off-exchange share by symbol type, retail intensity, and blockiness. You can ignore it only if you are explicitly testing exchange-only logic. citeturn0search4turn0search1turn12search6turn12search3

**Delayed, late, corrected, and canceled prints.** Official feed protocols explicitly support prior-day, late, out-of-sequence, cancel/error, and correction semantics in both equities and options. This matters enormously for replay validation because many “anomalies” disappear after corrections or are obvious artifacts of lateness. A simple approximation is a rare deterministic late-print path and a rare deterministic cancel/correction path keyed to prior event IDs. A more realistic one uses venue-dependent probabilities and sale-condition fields. You should never ignore these for any serious ingestion or alert system. citeturn13view5turn18search0turn24view2turn4search7turn0search1

**Price discreteness and tick sizes.** Quotes and trades live on discrete grids, not on continuous Gaussian fantasy lines. For equities, Regulation NMS Rule 612 governs minimum pricing increments; for options, minimum price variations depend on the product and program. This matters because synthetic prices that glide continuously through impossible levels will poison downstream logic. A simple approximation is strict rounding to valid MPV/tick rules. A more realistic approximation uses asset-specific tick programs, penny options behavior, and special cases for sub-dollar equities. You cannot ignore discreteness. citeturn0search6turn0search9turn16search0turn16search6turn16search2

**Volatility and liquidity regimes.** Volatility clusters over time, and liquidity co-moves across names and sectors rather than staying flat. This is one of the most important facts to preserve because alert systems often key off rolling z-scores and relative regimes. A simple approximation is a hidden Markov model or manually switched regime variable. A more realistic one couples volatility, spread, and arrival intensities and allows sector-level commonality. You can ignore fine regime inference, but not regime switching itself. citeturn1search0turn11search3turn6search12

**Symbol-specific behavior and sector correlation.** Real names differ a lot, and they also load on common market and industry factors. This matters because a synthetic universe where every ticker behaves like the same blob will make cross-symbol comparison features useless. A simple approximation is symbol profiles plus a market factor and a sector factor. A more realistic one adds liquidity commonality and correlated regime shifts across sectors. You can ignore elaborate factor models in the MVP, but not cross-sectional heterogeneity. citeturn11search3turn27search14turn27search5

**Options-chain structure.** Real chains are sparse in trading activity even when they are dense in listings. Exchanges and OCC mechanics create standardized expiries, strike intervals, and contract conventions, but actual activity concentrates in a minority of active series. This is critical for realism because a synthetic chain where every listed contract trades regularly is obviously fake. A simple approximation is to generate full listings but confine most trades and tight quotes to front expiries near spot. A more realistic one builds activity weights by expiry, moneyness, and regime and lets many contracts quote sparsely or not trade at all for long stretches. You cannot ignore chain sparsity. citeturn19search16turn19search3turn19search7turn19search11

**Expiration-specific, moneyness-specific, and 0DTE behavior.** Option spreads and activity vary strongly by time to maturity, moneyness, and especially in very short-dated contracts. Short-dated and near-ATM contracts tend to be more behaviorally sensitive, while far OTM or less active contracts can be wide and sparse. This is important because those dimensions heavily affect whether a print should look ordinary or suspicious. A simple approximation is a parametric activity surface over expiry and moneyness. A more realistic one uses separate surfaces for normal, event, and 0DTE regimes plus gamma-sensitive quote widths. You can ignore some curve detail in early demos, but not the concentration of action near the front and near spot. citeturn26view1turn29view1turn2search2turn19search0

**Open interest versus volume.** Open interest is not the same thing as volume, and it updates by opening/closing mechanics rather than simply counting trades. That distinction matters because many flow signals rely on volume versus existing positioning. A simple approximation is to hold open interest as a prior-day state and update next-day OI from hidden opening/closing flags. A more realistic one models opening/closing propensities by trader archetype and lets OI respond at end of day only. You should not ignore the distinction. citeturn2search1turn2search16turn13view4

**Implied-volatility skew and surface roughness.** Option IV surfaces are structured, not flat, but they are also not perfectly smooth. Equity options often show skew; around earnings and short-dated event risk, shapes can become more distorted or even concave in localized regions. This matters because a perfectly clean surface looks synthetic, while a wildly jagged one produces fake anomalies. A simple approximation is a base ATM level plus term structure plus monotone skew with bounded noise. A more realistic one uses an arbitrage-aware parameterization such as SVI with local roughness constrained by no-static-arbitrage checks. You can ignore full arbitrage-free fitting in the MVP, but not skew and bounded roughness. citeturn10search4turn10search8turn3search14turn17search3

## Generation methods and model choices

A good synthetic generator is not “the most academic model you can name.” It is the simplest model stack that reproduces the microstructure facts that matter for your tests. Simpler Monte Carlo and bootstrap methods remain useful, but they struggle when the goal is realistic **joint** behavior across trades, quotes, spreads, venues, and alerts. Richer LOB, ABM, and generative ML methods can add realism, but they come with higher implementation cost and much tougher validation requirements. citeturn23view0turn20view2turn21view1turn20view4

**Simple random generators.** Good for schema tests, smoke tests, and fuzzing. Bad for realism, because IID timings and sizes produce data that is simultaneously too random and too clean. Complexity is very low, determinism is excellent, calibration needs are minimal, and labeled scenarios are easy, but realism is poor and false positives/non-failures will not resemble production. MVP suitability: only as a subcomponent, not the main engine. citeturn1search0turn22view2

**Calibrated empirical resampling.** Good for preserving observed marginal distributions and easy-to-explain realism once real data exists. Bad for day-one MVP because it depends on real samples, and naive resampling often breaks temporal structure or underproduces rare edge cases. Complexity is low-to-medium, determinism is good, overfitting risk is moderate if sample windows are too narrow. MVP suitability: future upgrade, not current foundation. citeturn23view0turn20view2

**Bootstrapping historical windows.** Good for demos and “looks real” replay when enough history exists. Bad for coverage of rare conditions, symbol generalization, and parameter explainability. Complexity is low, realism can be high in-sample, determinism is excellent if windows and seeds are pinned, but calibration dependence is absolute. MVP suitability: future replay layer, not no-history-first MVP. citeturn23view0turn20view2

**Replay-plus-mutation.** Good for the best later-stage demo realism because it preserves authentic base structure and adds labeled perturbations. Bad when you have no historical tape and bad if mutations accidentally create impossible conditions. Complexity is medium, determinism is excellent, scenario injection is excellent, and overfitting risk is manageable if mutation is constrained. MVP suitability: strong future direction after basic synthetic background exists. citeturn20view2turn23view0

**Parametric stochastic models.** Good for MVP because they are transparent, configurable, deterministic, and can encode known stylized facts without needing training data. Bad because hand-chosen parameters can miss asset-specific quirks and can look “engineered” if not stress-tested. Complexity is medium. Realism is medium-to-high if you couple multiple state variables rather than just simulating returns. MVP suitability: excellent. citeturn1search0turn20view1turn26view1

**Poisson processes.** Good as a base layer for arrival times because they are easy, deterministic with a seed, and composable. Bad because plain Poisson arrivals miss clustering and burstiness. Complexity is low; realism is low unless intensity is state-dependent and time-varying. MVP suitability: useful as a baseline, but upgrade with burst states or self-excitation quickly. citeturn22view2turn20view1

**Hawkes or self-exciting processes.** Good for clustered arrivals, bursty prints, and “flow begets flow” behavior, especially in high-frequency contexts. Bad because full calibration is harder and unconstrained branching can create runaway synthetic nonsense. Complexity is medium. Realism is high for timing structure, determinism is good, and scenarios can be injected cleanly by shifting baseline intensities. MVP suitability: good as a **lite** burst overlay, not necessarily a full calibrated multivariate Hawkes system on day one. citeturn22view2turn20view1

**Regime-switching models.** Good for volatility/liquidity state changes, open/midday/close behavior, event days, and calm-versus-chaotic tapes. Bad because regime definitions can become arbitrary if you model too many. Complexity is medium, determinism is excellent, and no history is required for a hand-authored first cut. MVP suitability: excellent, especially when combined with parametric quote/trade emitters. citeturn6search12turn1search0

**Agent-based models.** Good for emergent behavior, stress scenarios, strategic interaction, and deeper “why did the tape look like this?” simulation. Bad for MVP because assumptions about heterogeneous agents dominate the output, validation is hard, and implementation time is high. Complexity is high, realism can be high in special cases, but controllability for labeled alert testing is worse than people think. Future suitability: selective research layer, not the backbone of Islandflow’s first synthetic system. citeturn21view1turn21view0

**Synthetic limit-order-book models.** Good for endogenous quote/trade interactions and high-fidelity market-microstructure replay. Bad because they are expensive to implement correctly, require many assumptions or calibration data, and are overkill if your downstream platform mainly consumes print/quote streams rather than full depth. Complexity is high; realism can be very high; determinism is good. Future suitability: strong for advanced benchmarking and execution research, but not needed to ship alert testing first. citeturn20view1turn20view2

**Scenario injection into synthetic background.** Good for what you explicitly need: labeled, replayable, threshold-targeted tests. Bad only if it is done clumsily and makes every injected scenario obvious or impossible. Complexity is medium, determinism is excellent, and calibration needs are low. MVP suitability: mandatory. citeturn23view0

**Generative ML.** Good when you have enough high-quality real data, strong evaluation, and a reason to generate highly realistic dependencies that hand models miss. Bad for a no-history-first MVP because training data, evaluation data, and overfitting control all become first-order problems. Complexity is high, determinism is weaker than with explicit simulators unless sampling and model versions are tightly pinned, and labeled scenarios often require a separate control interface anyway. Future suitability: experimental layer after you already have calibrated baselines and solid metrics. citeturn20view4turn6search2turn23view0

My ranking is blunt. **MVP:** regime-switching parametric background + discrete quote/trade state machines + Hawkes-lite burst overlay + scenario injection. **Later:** replay-plus-mutation and empirical calibration. **Much later:** selective LOB/ABM/ML where they win on measured fidelity, not on vibe. citeturn20view2turn23view0turn21view1

## No-historical-data-first generator design

The no-history-first generator should be organized around five layers: **symbol profiles**, **market regimes**, **latent fair-value paths**, **quote/trade emitters**, and **scenario injections**. Symbol profiles control baseline liquidity and volatility class. Regimes control time-of-day and event state. Latent paths move a hidden fair value and, for options, a hidden ATM IV state and skew state. Emitters convert hidden state into discrete trades and quotes on valid ticks with realistic timing and imperfections. Scenario injections bias or override selected components and attach ground-truth labels and expected outputs. That architecture stays transparent, deterministic, and testable. It also lines up with the fact that simpler transparent methods are a practical starting point when data are scarce. citeturn23view0turn20view1turn22view2

The defaults below are **engineering priors, not empirical truths**. They are deliberately conservative guesses chosen to avoid the two classic failures of synthetic market data: streams that are so clean they never trigger anything, and streams that are so noisy every unusual print looks important. Every default should be configurable. Every default should later be validated against real tapes when available. The point of the MVP is not perfect realism; it is realism that is good enough to test Islandflow’s signal logic without lying to it. That approach is consistent with market-microstructure literature emphasizing persistent stylized facts but also cross-symbol variation, and with synthetic-data guidance that recommends transparent baselines first and progressive refinement later. citeturn1search0turn11search3turn23view0

**Conservative default parameter strategy**

| Parameter family | Conservative MVP default | Why this is a safe guess | Must be configurable | Validate first when real data arrives |
|---|---|---|---|---|
| Equity trade arrival rate | Quiet 0.01–0.10 trades/sec; normal 0.10–2; active 2–20 during core hours. Open x2–4, midday x0.4–0.7, close x1.5–3 | Captures large cross-sectional dispersion and intraday U-shape without overwhelming infra | Yes, by symbol bucket and time-of-day curve | Per-symbol trade-count distributions and open/mid/close multipliers |
| Equity quote update rate | Roughly 3x–10x trade rate; quiet 0.1–1 updates/sec; normal 1–10; active 10–100 | Quotes change more often than trades, but this stays conservative for offline dev | Yes | Per-symbol message-rate histograms and quote/trade ratios |
| Equity spread | Active liquid names mostly 1–2 ticks; normal 1–5 ticks; quiet 2–20 ticks or 5–40 bps, whichever is larger | Preserves discrete ticks and large liquidity differences | Yes | Spread percentiles by symbol and time-of-day |
| Equity size distribution | Mixture: many odd lots, common 100/200/500-share modes, rare 1k–25k, occasional larger benign blocks | Matches lumpy size reality and odd-lot significance without overdoing blocks | Yes | Trade-size histogram, odd-lot rate, block tail |
| Off-exchange share | 10%–25% of trades for quieter names, 20%–40% for retail-heavy active names, higher only in specific venue profiles | Conservative relative to the importance of off-exchange activity in U.S. equities | Yes | TRF share by symbol and by message count vs share volume |
| Burst frequency | Active: 1–3 ordinary bursts/hour; normal: 1 every 2–4 hours; rare large burst 0–2/day | Keeps the stream lifelike without turning every window into a cluster | Yes | Inter-arrival run lengths and burst-size distributions |
| Option volume vs OI | Front, near-ATM liquid contracts often live in volume/OI ratios around 0.1–0.5 for routine days; long-dated/far OTM often near zero; 0DTE near-ATM may exceed 1.0 without being “institutional” | Encodes concentration of activity without making every contract hyperactive | Yes | Contract-level volume/OI distributions by expiry and moneyness |
| Option quote width | Front ATM liquid: often 1–2 ticks or single-digit % of premium; farther OTM/ITM, shorter-dated jumpy names, and illiquid contracts: much wider, often double-digit % of premium | Reflects known spread dependence on moneyness, maturity, and hedging difficulty | Yes | Width by moneyness, tenor, premium, and liquidity bucket |
| 0DTE profile | Higher quote churn, higher near-ATM concentration, faster migration between strikes, more limited-risk spread flow, more intraday bursts, but balanced net direction in background | Reflects large gamma and intense intraday use without forcing directional signals | Yes | Intraday strike-switching, buy/sell balance, spread usage, gamma-sensitive width |
| IV skew roughness | Base monotone skew plus bounded strike-local perturbations of ~0.5–2 vol points in liquid names and ~2–5 in thin names | Enough roughness to avoid “computer-perfect” surfaces without making arbitrage soup | Yes | Residual roughness after fitting simple skew/term structure models |
| Background alert targets | High-confidence alerts: essentially zero to very rare; medium-confidence: rare; low-confidence/abstain: modest but nonzero | The background should usually fail confirmation tests, not constantly pass them | Yes, by test suite | Real baseline alert incidence and abstention rates |

The reasoning behind those defaults is straightforward. Documented market structure tells you to expect discrete ticks, variable spreads, clustered arrivals, odd lots, significant off-exchange reporting, options-chain sparsity, and spread dependence on expiry/moneyness/liquidity. It does **not** tell you “AAPL must produce exactly X trades per second” without data. So the safe MVP move is to choose broad symbol buckets and conservative ranges, not fake precision. citeturn0search6turn13view1turn0search4turn26view0turn26view1turn29view1

For false-positive management, I recommend an explicit **anomaly budget**. In background mode, do not let more than one strong confirming dimension co-occur too often. For example, allow a big options ask-lift **or** a volume/OI oddity **or** a modest IV pop **or** mild spot confirmation, but usually not all of them in the same rolling window unless a labeled scenario is active. That design is justified by the literature showing that option volume imbalances, skew, and certain option-market features can carry information about future stock moves; those combinations should be reserved for controlled tests, not sprayed into the background by accident. citeturn28search1turn28search8turn11search7

**Future calibration path**

When historical samples become available, collect statistics in this order. First, get **equity trade counts, quote counts, spread distributions, trade-size distributions, odd-lot shares, off-exchange shares, late/cancel/correction rates, and intraday curves** by symbol bucket. Second, get **options contract activity weights** by expiry and moneyness, plus quote widths, trade-side price placement versus bid/mid/ask, and volume/OI distributions. Third, get **joint** features: burst duration, trade-sign persistence, sector co-movement, and alert-base-rate outcomes. Roughly **20–60 trading days** is enough to stabilize intraday curve estimates for liquid names; **3–6 months** is better for options-chain distributions and event-conditioned behavior. That is a recommendation, not a regulatory truth, but it is the practical minimum if you want robust fits without being fooled by one weird week. citeturn20view2turn23view0

Fit real-data parameters hierarchically rather than naively per symbol. That means learning bucket-level priors first—quiet/normal/active equities, liquid/standard/thin options underlyings, event versus non-event days—and then shrinking symbol-specific estimates toward those priors. Compare synthetic versus real using marginal distributions, inter-arrival survival curves, autocorrelation or excitation diagnostics, spread-state occupancy, venue shares, volume/OI relationships, and alert outputs from the same downstream detector. Use holdout windows so you do not “optimize the tape to the test.” And once you calibrate, keep determinism by versioning **parameter snapshots** and pinning each test to a snapshot hash plus seed. citeturn1search0turn22view2turn23view0

## Synthetic options and equity models

**Synthetic options model**

Start with the **underlying**. Use a latent mid-price process driven by a market factor, optional sector factor, symbol idiosyncratic noise, and a regime-switching volatility state. For the MVP, a discrete-time jump-diffusion or stochastic-volatility-lite process is enough if you also apply an intraday volatility envelope and hard tick rounding downstream. The key is that underlying movement must be path-dependent and regime-dependent, not IID. citeturn1search0turn6search12

Generate the **chain** from standardized mechanics: near expiries, weeklies where applicable, monthlys, and for index-like profiles optionally daily expiries that produce 0DTE behavior. Use standard strike intervals as a seed and allow optional finer exchange-program overrides. For single-name equity options, keep the common pattern of most interest in nearer expiries and strikes around spot. For index-like chains, let daily expiries exist and let same-day expiries dominate intraday activity only when the profile says so. citeturn19search16turn19search0turn19search7turn19search1turn19search3

Generate **IV** as three pieces: a latent ATM level, a term-structure function, and a moneyness/skew function. Then add bounded roughness. For MVP realism, a good shape is: higher IV in short-dated event-sensitive series around earnings; a negative skew for many equity option surfaces; and local perturbations that are small in liquid chains and larger in thin chains. For the future, move to an arbitrage-aware SVI-like representation. Earnings mode should allow front-expiry uplift and occasional short-dated concavity rather than only a smooth monotone skew. citeturn10search4turn10search8turn3search14turn17search3turn17search16

Generate **option quotes** from theoretical mid plus a width function. Width should depend on: liquidity class, time to expiry, distance from spot, option premium level, and latent option-return volatility. The data and literature support the intuition that spreads are affected by moneyness, maturity, volatility, and the liquidity of the underlying/hedge. For the MVP, make width the maximum of MPV, a premium-percentage term, and a volatility-risk term. This beats pretending every contract is penny-wide. citeturn26view0turn26view1turn16search0turn16search6

Generate **quote cadence** and **trade cadence** separately. Quotes should update more often than trades; some contracts should mostly quote and seldom trade; many contracts should go long stretches with unchanged or stale quotes; and active front contracts should churn much more. Activity allocation across the chain should be highly concentrated in a minority of contracts, especially near spot and near expiry. That sparsity is one of the biggest realism wins you can get cheaply. citeturn20view2turn26view1turn19search16

Generate **trade prices relative to bid/mid/ask** from an aggressiveness mixture, not from a single rule. In background mode, single-leg flow should include buy-at-ask, sell-at-bid, and many trades inside the spread or around a micro-mid when the market is wider. Complex and spread-like flow should often print closer to net mid than to an obviously directional extreme. Trade size should be a mixture: many 1–10 lots, some 20–100 lots, and rare larger benign institutional-looking prints in liquid contracts. citeturn24view2turn26view1

Generate **volume** as the cumulative sum of trades, but generate **open interest** separately as prior-day outstanding contracts. Internally tag each trade as open/open, close/close, or one-side-open one-side-close, then update next-day OI from those hidden tags. That lets you test volume/OI anomaly logic without abusing OI as a live intraday counter. OPRA and OCC semantics support the distinction between messages carrying volume and messages carrying open-interest-related fields. citeturn2search1turn2search16turn13view4

For **Greeks**, use a rough approximation only. Black-Scholes or Bachelier with a simple carry assumption is good enough for synthetic metadata as long as you label it approximate and compute it from your own latent IV and underlying states. Greeks here are not sacred truth; they are context for scenarios and evidence fields. If a later phase uses empirical calibration, replace the rough formula with a model consistent with your fitted IV surface. citeturn2search11turn3search14

Include these ordinary **flow archetypes** in background mode:
- **Retail-like flow:** small-lot single legs, some far OTM lottery activity, more ask-lifts than mids in very cheap contracts, but two-sided over longer windows.
- **Benign institutional-looking flow:** medium-size trades in liquid contracts, often near mid or as part of risk-defined spreads, not accompanied by dramatic spot or IV confirmation.
- **Market-maker / hedge-like flow:** short sequences that offset prior imbalance, mixed side, often in near-ATM and neighboring strikes.
- **Spread-like multi-leg flow:** tagged linked legs with net premium logic; important so the platform learns not to misread them as pure directional buys.
- **Sweep-like but benign clusters:** multiple near-simultaneous prints across adjacent exchanges or adjacent strikes, capped in size and usually lacking full confirmation.
- **Event-volatility regime:** pre-earnings short-dated IV uplift and extra front-expiry volume, but not necessarily directional call buying.
- **Low-liquidity contracts:** sparse quotes, wide markets, occasional stale quotes, tiny sizes.
- **0DTE behavior:** stronger near-ATM concentration, quicker strike migration, higher burstiness, and gamma-sensitive quote updates. citeturn29view1turn29view0turn17search3turn17search16

The important “don’t accidentally look institutional or directional” rule is this: **background options activity should usually fail at least one major confirmation axis**. In practice that means large prints often occur in already-active, reasonably liquid series; buy-side and sell-side aggression should balance over medium windows; large ask-lifted call activity should usually lack strong spot confirmation, lack a clean IV expansion confirmation, or occur inside spread/complex-order context; and repeated same-side sweeps should be rare unless deliberately injected. That recommendation is directly informed by the literature showing that certain option-volume imbalances and skew features can predict future stock returns under some conditions. Reserve those clean combinations for labeled scenarios. citeturn28search1turn28search8turn11search7

**Synthetic equity model**

Use the same basic architecture for equities: a latent fair-value path with market + sector + idiosyncratic components, then a top-of-book quote process and a separate trade process that sample from the latent state. Spread should be discrete and state-dependent. Quotes should move with public information, inventory changes, and cancellation/repost dynamics even when no trade occurs. Trades should sometimes print without altering the quote if displayed depth is assumed to absorb them. citeturn20view1turn25search22

Generate **quote events** as a best-bid/best-offer pair on valid ticks. Add staleness, temporary widening, and rare invalid or locked/crossed cases as explicit edge injections. Generate **trade events** with venue flags, aggressor side, and sale-condition metadata. Allocate some prints to lit venues and some to off-exchange/TRF-like venues, because that is normal U.S. reality. Late, prior-day, cancel, and correction paths should be rare but deterministic and should reference stable prior IDs. citeturn0search4turn0search1turn13view5turn18search0

For **size distributions**, use the same lumpy-mixture logic as in the default table. Keep many small and odd-lot trades, many 100-share-ish prints, and a long but thin tail of larger prints. For **price placement**, let many trades happen near the bid or ask, some inside spread, and some midpoint-like for off-exchange benign prints. For **intraday shape**, impose open/close intensity increases and midday softness. Add sector-correlation and market-correlation so that theme-level dashboards and alerts can be tested against weak common moves. citeturn25search1turn11search3turn27search14

The “don’t accidentally look like accumulation/distribution or dark-pool confirmation” rule for equities is similar to the options rule. Background mode should avoid long runs of one-sided large off-exchange blocks followed by consistent price drift. If you emit a benign block-like print, make it near NBBO or midpoint, avoid immediate same-direction follow-through, and often surround it with contradictory or neutral smaller flow. If you emit repeated off-exchange prints, keep them mixed side or decouple them from subsequent directional price movement unless that confirmation is the whole point of the scenario. citeturn12search2turn0search4turn12search3

## Alert-safe background and controlled scenarios

**Alert-safe background generation recipe**

Use a **regime-aware latent-state background** with four independent but coupled generators: fair value, quote state, trade arrivals, and venue/condition metadata. Keep trade arrivals mildly self-exciting, quote updates faster than trades, spreads discrete and state-dependent, sizes lumpy, and hidden confirmation features intentionally incomplete. That last part matters most: boring realistic data is not data with no anomalies; it is data where anomalies usually have weak, conflicting, or ambiguous evidence. citeturn22view2turn20view1turn25search22

For core distributions, use lognormal or discrete-mixture sizes; state-dependent Poisson or Hawkes-lite arrivals; Markov or HMM-like volatility/spread regimes; and bounded IV roughness for options. Keep ordinary bursts, ordinary quote staleness, occasional wide spreads, ordinary 0DTE/chasing-small-premium behavior, and ordinary harmless spread-like structures in the background. The stream should feel messy enough that low-confidence flags and abstentions are common, but clean enough that high-confidence alerts remain rare outside scenario injection. citeturn22view2turn6search12turn29view1

To avoid crossing thresholds too often, define **suppression constraints** in the generator itself. Examples: cap the number of consecutive same-side ask-lifted option prints in one contract unless the contract is already high-OI and high-volume; cap simultaneous co-occurrence of premium anomaly + volume/OI anomaly + IV expansion + price confirmation in background mode; limit repeated same-side TRF blocks; and attach penalties to stale-quote windows, wide-spread windows, earnings-event windows, low-liquidity windows, complex-order windows, and correction/cancel windows. Those penalties belong in the expected-output manifest, not just in the detector. citeturn9search0turn17search16turn28search1

A good target for background streams is: **high-confidence alerts should be nearly absent**, **medium-confidence alerts should be rare**, and **low-confidence or abstain should appear often enough to prove the model is not too clean**. In practice, a useful heuristic target is that fewer than roughly 1 in 2,000 rolling windows produce a high-confidence alert, with medium-confidence alerts an order of magnitude more common, and abstentions materially more common than either. That is an engineering target, not a fact claim; tune it to your detector’s architecture. What matters is that the background mostly fails high-confidence confirmation logic.

**Controlled synthetic scenario catalog**

Below is a concrete catalog you can hand to implementation planning. Confidence ranges are intentionally broad because the detector’s exact math is not yet fixed.

| Scenario | Setup and required inputs | Expected outputs |
|---|---|---|
| Aggressive directional call buying | Rising underlying drift, several ask-lifted call prints in near-ATM/front expiry, premium anomaly, healthy OI context, mild IV expansion | High-confidence bullish options alert; confidence ~0.80–0.95; evidence fields: aggressor=buy, call_put=call, premium_z, volume_oi_ratio, iv_change, spot_change, sweep_cluster_count; reasons mention repeated aggressive call buying with confirmation; replay check: identical alert IDs and score band |
| Aggressive directional put buying | Mirror of above using puts, negative spot drift, IV expansion | High-confidence bearish options alert; confidence ~0.80–0.95; same evidence shape; false-positive penalties low |
| Repeat sweep or burst cluster | Several fast same-side prints across venues/contracts inside short window; some but not necessarily all price confirmation | Medium-to-high alert if direction and confirmation align; confidence ~0.70–0.90; reasons mention repeated clustered aggression |
| Premium anomaly | One or more unusually large premium trades in liquid contract without full price confirmation | Medium alert if other context supports; otherwise low-confidence watch; confidence ~0.55–0.75 |
| Volume/OI anomaly | Day volume ramps unusually versus prior OI in selected contract or expiry bucket | Medium-to-high alert if paired with aggressor and side consistency; otherwise abstain; confidence ~0.60–0.85 |
| IV expansion confirmation | Front-expiry IV rises with same-side aggressive flow and moderate spot support | Medium-to-high alert; confidence ~0.70–0.90; evidence should include iv_surface_shift and skew_shift |
| Price confirmation | Options or equity flow occurs alongside spot break or steady follow-through | Stronger alert weighting; confidence uplift +0.10–0.20 versus base case |
| Equity/off-exchange confirmation | Benign-looking options or lit flow is confirmed by off-exchange equity prints or consistent lit prints | Medium-to-high signal if side matches and timing is plausible; otherwise mild uplift only |
| Stale quote false positive | Trade appears aggressive only because quote is frozen while latent fair value moved | No alert or forced low-confidence; confidence ~0.00–0.25; reasons should mention stale quote / quote age penalty |
| Wide-spread false positive | Ask-lift occurs in very wide options market or thin equity market | No alert or low-confidence; confidence ~0.00–0.25; reasons mention spread penalty and poor price-discovery quality |
| Earnings-noise false positive | Increased front-expiry options and IV before earnings without clean direction | Abstain or low-confidence; confidence ~0.10–0.35; reasons mention event-volatility regime |
| Spread misread as directional | Multi-leg spread broken into leg prints that individually look bullish or bearish | No directional alert; confidence ~0.00–0.30; evidence should show linked_leg_group and complex-order penalty |
| Hedge/reactive flow | Opposite-side small-to-medium trades after prior move, near-ATM concentration, weak net premium anomaly | No alert or low-confidence “reactive/hedge-like” tag; confidence ~0.20–0.45 |
| Benign block print | Large off-exchange or midpoint-like equity/or option print with no follow-through | No alert; confidence ~0.00–0.30; reasons mention benign block / no confirmation |
| Low-liquidity trap | Thin contract with very wide quotes, small OI, noisy prints at bid/ask extremes | Abstain; confidence ~0.05–0.40; penalties: low_liquidity, wide_spread, poor_reference_price |
| Delayed or corrected print | Late/out-of-sequence or corrected trade that initially looks anomalous | Either no alert or alert withdrawn/marked superseded after correction; confidence collapses after replayed correction path |
| Quote-alignment failure | Missing/invalid/locked/crossed quote context for a print | Abstain or parser/error state; confidence ~0.00–0.15; reasons mention quote alignment failure |
| Abstention case | Ambiguous mixed evidence by construction: moderate size, mixed sides, mixed venue, no clear spot/IV confirmation | Explicit abstain state; confidence ~0.10–0.30; reason string should explain conflicting evidence |

For every scenario, emit a **ground-truth label event** and an **expected-output manifest** that specifies: expected alert class or no-alert, target confidence band, required evidence keys, forbidden evidence keys, false-positive penalties that must fire, and replay checks such as exact event IDs, order of derived events, and deterministic hashes of alert payloads. That lets you validate not just “something fired,” but “the right thing fired for the right reason.”

## Determinism, validation, schema examples, and bibliography

A synthetic system only becomes useful in engineering when it is **boringly reproducible**. Use seeded PRNGs with stable stream partitioning: one seed for symbol universe, one for price paths, one for quote emission, one for trade emission, one for metadata mutation, and one for scenario injection. Counter-based or splittable generators are preferable because they make sequence partitioning and parallel generation easier without accidental cross-talk. Treat **event time** as canonical and **processing time** as a separate replay concern. Delays, corrections, and late prints should have deterministic rules tied to seeded schedules or explicit scenario config, never to wall-clock timing. Stable event IDs should be derived from run ID + logical stream + sequence number.

Your testing stack should include **fixture snapshots**, **golden tests** for specific replays, **property-based tests** for invariants, **fuzz tests** for malformed or adversarial inputs, and **load-test profiles** that multiply message rates without changing event semantics. The core invariants are things like: bid <= ask unless deliberately invalid; prices on valid ticks; cumulative volume monotone except when reset by session; corrections reference real prior IDs; next-day open interest equals prior OI plus hidden opening/closing delta; and replay output is identical for the same parameter snapshot and seed.

**Validation metric checklist**

- Distribution checks for returns, spread states, size buckets, venue shares, and option chain activity
- Inter-arrival checks, including burst frequency and quiet-run length
- Quote-alignment checks: percent of prints at bid/mid/ask buckets, stale-quote incidence, invalid-quote incidence
- Trade-size checks, including odd-lot share and benign block tail
- Alert-rate checks by symbol bucket, regime, and asset class
- False-positive checks on designated trap scenarios
- Abstention-rate checks in ambiguous or degraded data conditions
- Determinism checks: byte-identical or hash-identical replay outputs for fixed seed + config + parameter snapshot
- Scenario pass/fail checks against expected confidence bands, evidence fields, and reason strings
- Load/performance checks under scaled message-rate profiles
- Visual dashboards: intraday activity curves, spread heatmaps, options expiry/moneyness heatmaps, alert timelines, and QQ/ECDF comparisons once real data exists

**Implementation-neutral schema and config examples**

```yaml
symbol_profile:
  symbol: AAPL
  asset_class: equity
  sector: technology
  liquidity_bucket: active
  volatility_bucket: medium
  venue_profile: retail_heavy
  baseline_price: 210.00
  baseline_daily_vol_bp: 180
  trade_rate_core_per_sec: [2.0, 8.0]
  quote_rate_core_per_sec: [20.0, 60.0]
  spread_ticks_normal: [1, 2]
  spread_ticks_stress: [2, 6]
  odd_lot_share_range: [0.25, 0.45]
  off_exchange_trade_share_range: [0.25, 0.40]
  intraday_curve: u_shape_standard
```

```yaml
option_chain_profile:
  underlying: AAPL
  style: equity_option
  expiries:
    near_weeklies: 4
    monthlies: 3
    leaps: 1
  strike_policy:
    around_spot_pct: 0.25
    standard_intervals: true
    allow_program_overrides: true
  activity_weights:
    by_moneyness:
      atm: 1.00
      near_otm: 0.70
      far_otm: 0.15
      deep_itm: 0.10
    by_tenor:
      zero_dte: 1.20
      one_week: 1.00
      one_month: 0.70
      longer_dated: 0.15
  quote_width_model:
    base_ticks: 1
    premium_pct_floor: 0.03
    volatility_risk_multiplier: 1.0
    low_liquidity_multiplier: 2.5
  iv_surface:
    atm_iv: 0.32
    term_slope: -0.04
    downside_skew: -0.12
    local_roughness_vol_points: [0.5, 2.0]
```

```yaml
market_regime_profile:
  name: calm_regular_session
  session: regular
  vol_multiplier: 1.0
  liquidity_multiplier: 1.0
  quote_update_multiplier: 1.0
  burst_probability_per_minute: 0.01
  stale_quote_probability_per_minute: 0.002
  wide_spread_probability_per_minute: 0.003
  event_context: none
```

```json
{
  "quote_event": {
    "event_id": "q_AAPL_0000019284",
    "event_time_ns": 1771242301000000000,
    "symbol": "AAPL",
    "venue": "NASDAQ",
    "bid_price": 209.98,
    "bid_size": 300,
    "ask_price": 209.99,
    "ask_size": 500,
    "quote_age_ms": 0,
    "flags": {
      "synthetic": true,
      "stale": false,
      "wide": false,
      "locked_or_crossed": false,
      "invalid": false
    },
    "regime": "calm_regular_session"
  }
}
```

```json
{
  "trade_event": {
    "event_id": "t_AAPL_0000011155",
    "event_time_ns": 1771242301123000000,
    "symbol": "AAPL",
    "venue": "TRF",
    "price": 209.99,
    "size": 150,
    "sale_condition": "regular",
    "aggressor": "buy",
    "reference_quote_id": "q_AAPL_0000019284",
    "relative_to_quote": "ask",
    "flags": {
      "synthetic": true,
      "late": false,
      "out_of_sequence": false,
      "corrected": false,
      "cancelled": false,
      "off_exchange": true
    }
  }
}
```

```json
{
  "correction_event": {
    "event_id": "c_AAPL_0000000042",
    "event_time_ns": 1771242305123000000,
    "original_event_id": "t_AAPL_0000011155",
    "action": "correct",
    "corrected_fields": {
      "price": 209.985,
      "sale_condition": "late"
    }
  }
}
```

```yaml
scenario_injection_event:
  scenario_id: scn_call_buying_001
  start_event_time_ns: 1771245900000000000
  duration_ms: 180000
  target_underlying: AAPL
  target_contract_selector:
    expiry_bucket: front
    moneyness_bucket: atm_to_near_otm_calls
  controls:
    aggressor_bias: buy
    premium_multiplier: 3.5
    burst_multiplier: 4.0
    iv_shift_vol_points: 1.8
    spot_drift_bp: 35
    sweep_cluster_probability: 0.6
```

```yaml
ground_truth_label_event:
  scenario_id: scn_call_buying_001
  label: aggressive_directional_call_buying
  expected_alert_class: bullish_options_flow
  expected_confidence_range: [0.80, 0.95]
  expected_evidence_fields:
    - premium_z
    - volume_oi_ratio
    - iv_change
    - spot_change
    - aggressor_consistency
  expected_penalties_absent:
    - stale_quote_penalty
    - wide_spread_penalty
```

```yaml
expected_output_manifest:
  run_id: demo_2026_06_16_seed_42
  detector_expectations:
    - scenario_id: scn_call_buying_001
      alert_required: true
      confidence_range: [0.80, 0.95]
      reason_must_include:
        - aggressive call buying
        - price confirmation
      reason_must_not_include:
        - stale quote
      derived_event_order:
        - cluster_detected
        - premium_anomaly
        - price_confirmation
        - alert_emitted
    - scenario_id: scn_stale_quote_fp_001
      alert_required: false
      abstain_allowed: true
      penalty_required:
        - stale_quote_penalty
```

```yaml
replay_manifest:
  run_id: demo_2026_06_16_seed_42
  seed_bundle:
    universe: 42
    price_paths: 43
    quotes: 44
    trades: 45
    metadata: 46
    injections: 47
  parameter_snapshot_hash: "sha256:9f0b...c1d2"
  session_calendar: us_regular
  latency_model: deterministic_v1
  correction_schedule: deterministic_v1
  output_ordering: event_time_then_event_id
```

**Bibliography and source notes**

**Highest-weight sources**
- SEC, *Regulation NMS* final rules and Rule 612 guidance on equity tick sizes and quoting increments. citeturn0search6turn0search9turn13view1
- SEC, *Market Data Infrastructure* and related rules on odd-lot information and SIP structure. citeturn7search1turn13view1
- FINRA, TRF overview and trade-reporting FAQs for off-exchange equity reporting and cancel/reverse practices. citeturn0search4turn0search1
- CTA/UTP specifications for equity quote/trade messages, prior-day prints, cancels, corrections, and sale conditions. citeturn18search0turn18search2turn13view5
- OPRA output specification for options quotes, last-sale message types, late/out-of-sequence/cancel semantics, and volume/open-interest-related fields. citeturn13view4turn24view2
- OCC and OIC references for option contract conventions, expiries, strikes, weeklies, and open-interest mechanics. citeturn19search3turn19search7turn19search16turn2search1turn2search16
- Cont, *Empirical Properties of Asset Returns*, for core stylized facts such as heavy tails and volatility clustering. citeturn1search0
- Bacry, Mastromatteo, Muzy, *Hawkes Processes in Finance*, for self-exciting event modeling in high-frequency finance. citeturn22view2
- Cont and de Larrard, *Price Dynamics in a Markovian Limit Order Market*, for endogenous quote/trade interaction via queueing-style models. citeturn20view1
- Wei and Zheng; Cao and Wei / Engle-style literature on option spread dependence on moneyness, maturity, volatility, and underlying-market liquidity. citeturn26view0turn26view1
- Gatheral and Jacquier, plus related volatility-surface literature, for arbitrage-aware IV surface modeling. citeturn3search14turn10search8
- Pan and Poteshman; Easley, O’Hara, Srinivas; Xing et al. for the information content of option flow and skew. citeturn28search1turn28search8turn11search7

**Useful but weaker or more practitioner-oriented sources**
- Cboe practitioner material on 0DTE positioning and user behavior. Useful context, but not a substitute for peer-reviewed evidence. citeturn29view0
- Cboe practitioner updates on option penny increments and product programs. Useful for implementation detail. citeturn16search0turn16search15
- CFA Institute report on synthetic data in investment management. Strong on practical adoption guidance, but broader than market microstructure specifically. citeturn23view0

**Bottom line**
- **Recommended MVP synthetic data approach:** regime-switching parametric event generator with discrete quote/trade state machines, Hawkes-lite burst overlay, scenario injection, and expected-output manifests.
- **Recommended future synthetic data approach:** empirical calibration first, replay-plus-mutation second, selective LOB or generative ML third.
- **Alert-safe background recipe:** preserve realistic noise, venue mix, odd lots, staleness, wide spreads, ordinary 0DTE/speculative behavior, and incomplete confirmation.
- **Controlled scenario catalog:** explicit labeled injections with deterministic confidence bands, evidence requirements, and replay checks.
- **Synthetic options model:** latent underlying + sparse chain + expiry/moneyness/liquidity-sensitive quoting and trading + bounded IV roughness.
- **Synthetic equity model:** latent fair value + discrete spreads + separate quote/trade processes + venue/sale-condition realism.
- **No-historical-data-first parameter strategy:** conservative configurable priors, not fake precision.
- **Future calibration plan:** collect first-order distributions and intraday curves first, fit hierarchically, validate with holdouts, pin versioned snapshots for determinism.
- **Deterministic replay plan:** seeded generators, stable event IDs, event-time canonicalization, deterministic late/correct/cancel paths.
- **Validation checklist:** distributions, timings, spreads, size histograms, quote alignment, alert base rates, false positives, abstentions, performance, and deterministic replay hashes.