// GhostProtocol vault state machine. Invariant names (I*) refer to docs/threat-model.md.
//
// Actors (owner, witnesses, registrar, court, agent, relayer, anyone), the MPC network,
// Base Sepolia and the clock all move as nondeterministic steps. Witnesses are adversarial:
// any quorum may sign anything the contract accepts. The MPC network is honest unless a
// dependency failure (D*) switches part of it off. Constants are small so the model checker
// can enumerate every interleaving; contract/tests/itf_replay.rs runs the same constants.
module ghost {
  // ---------------------------------------------------------------- constants
  pure val NUM_HEIRS = 2
  pure val HEIRS = 0.to(NUM_HEIRS - 1)
  // An heir has at most its payout and one retry.
  pure val PAYOUT_IDS = 0.to(2 * NUM_HEIRS - 1)
  pure val NUM_WITNESSES = 3
  pure val WITNESSES = Set(0, 1, 2)
  pure val THRESHOLD = 2
  // Value unit is one gas-limit's worth of wei, so a reserve is value + CEILING.
  pure val FLOOR = 2
  pure val CAP = 3
  pure val INITIAL_FEE = 1
  pure val CEILING = 4
  pure val BUDGET = NUM_HEIRS * (CAP + 2 * CEILING)
  pure val INACTIVITY = 2
  pure val GRACE = 1
  pure val OVERRIDE_GRACE = 2
  pure val CONTEST = 1
  pure val FREEZE_MAX = 1
  // Must outlast every delay: max(GRACE, 2 * OVERRIDE_GRACE) + CONTEST * NUM_WITNESSES + FREEZE_MAX.
  pure val FALLBACK = 9
  pure val ADULT_BY: int -> int = Map(0 -> 0, 1 -> 4)
  pure val MAX_TIME = 12
  // A sign request with no callback after this long may be replaced (contract SIGN_LEASE_SECS).
  pure val LEASE = 1
  // Silence after which a normal claim needs no witnesses (D20).
  pure val ABANDON = 4
  // A retry after a reopened revert waits this long (contract REOPEN_DELAY_SECS).
  pure val REOPEN_DELAY = 1
  pure val MAX_EPOCH = 1
  pure val FEES = 1.to(CEILING)
  pure val VALUES = FLOOR.to(CAP)
  // Trace replay needs the last action in each state; exhaustive checking must not see it, or every
  // state is distinct by the step that reached it. check.sh flips this to false in a copy.
  pure val TRACE = true

  // ---------------------------------------------------------------- types
  // `public`: the MPC network signed it but the vault never stored it (lost or ignored callback).
  type Attempt = { fee: int, signed: bool, requestedAt: int, public: bool }
  type Payout = {
    heir: int, value: int, nonce: int, status: str, signing: bool, signingSince: int,
    attempts: List[Attempt], settledAttempt: int, source: str,
  }
  type Landing = { payout: int, attempt: int, ok: bool, finalized: bool }
  type Claim = {
    kind: str, openedAt: int, payAfter: int, contested: Set[int],
    frozenUntil: int, freezeUsed: bool, delay: int,
  }
  pure val NO_CLAIM: Claim = {
    kind: "None", openedAt: 0, payAfter: 0, contested: Set(), frozenUntil: 0, freezeUsed: false, delay: 0,
  }

  // ---------------------------------------------------------------- contract state
  var now: int
  var lastCheckIn: int
  var claim: Claim
  var epoch: int
  var heirStatus: int -> str
  var reopened: int -> bool
  var reopenedAt: int -> int
  var adultAt: int -> int
  var payouts: List[Payout]
  var committed: int
  var nextNonce: int
  var falseRevert: bool
  var wishesRequested: bool
  var signerRegistered: bool

  // ---------------------------------------------------------------- environment
  // Base: the vault address's account nonce, and every transaction that consumed one, in order.
  var chainNonce: int
  var landings: List[Landing]
  var baseFee: int
  var funded: bool
  // MPC requests in flight: ("sign", payout, requested_at) waits for `on_signed`,
  // ("settle", payout, attempt) for `on_settled`.
  var inflight: Set[(str, int, int)]
  // Dependency switches (docs/evidence/deps/). True = working as at the 3.18.0 snapshot.
  var signOk: bool
  var attestOk: bool
  var ckdOk: bool
  // False once a callback can run out of gas or storage (deps: nearcore gas costs, LackBalanceForState).
  var calleeGasOk: bool
  // Fairness context: owner alive, witnesses honest. Safety invariants never assume either.
  var ownerAlive: bool
  var honestWitnesses: bool
  // For trace replay.
  var lastAction: str
  var lastArgs: List[int]

  // ---------------------------------------------------------------- helpers
  def claimOpen = claim.kind != "None"
  def reserve(value) = value + CEILING
  def adultTime(h) = if (adultAt.get(h) < 0) ADULT_BY.get(h) else min(adultAt.get(h), ADULT_BY.get(h))
  pure def min(a, b) = if (a < b) a else b
  pure def max(a, b) = if (a > b) a else b
  def notFrozen = not(claimOpen) or now >= claim.frozenUntil
  def matured = claimOpen and notFrozen and now >= claim.payAfter
  def triggerProven(h) = matured and now >= adultTime(h) and heirStatus.get(h) == "Open"
  def payoutIdx = 0.to(payouts.length() - 1)
  def attemptIdx(p) = 0.to(payouts[p].attempts.length() - 1)
  def landed(p, a) = landings.select(l => l.payout == p and l.attempt == a).length() > 0
  def landedOk(p, a) = landings.select(l => l.payout == p and l.attempt == a and l.ok and l.finalized).length() > 0
  def lastFee(p) = payouts[p].attempts[payouts[p].attempts.length() - 1].fee
  // The landing a reopen claims reverted, if it did, on a finalized block. Honest witnesses wait for
  // finality, the same rule the MPC inspector applies to successes (tlc-v2-cex-reorg-revert.log:
  // a revert signed before finality was reorged into a success, and the heir was paid twice).
  def revertedOnChain(p, a) = landings.select(l => l.payout == p and l.attempt == a and not(l.ok) and l.finalized).length() > 0

  action record(name: str, args: List[int]): bool = all {
    lastAction' = if (TRACE) name else "",
    lastArgs' = if (TRACE) args else [],
  }

  action keepEnv: bool = all {
    chainNonce' = chainNonce, landings' = landings, baseFee' = baseFee, funded' = funded,
    signOk' = signOk, attestOk' = attestOk, ckdOk' = ckdOk, calleeGasOk' = calleeGasOk,
    ownerAlive' = ownerAlive, honestWitnesses' = honestWitnesses,
  }

  action keepContract: bool = all {
    lastCheckIn' = lastCheckIn, claim' = claim, epoch' = epoch, heirStatus' = heirStatus,
    reopened' = reopened, reopenedAt' = reopenedAt, adultAt' = adultAt, payouts' = payouts, committed' = committed,
    nextNonce' = nextNonce, falseRevert' = falseRevert, wishesRequested' = wishesRequested,
    signerRegistered' = signerRegistered,
  }

  // ---------------------------------------------------------------- init
  action init = all {
    now' = 0,
    lastCheckIn' = 0,
    claim' = NO_CLAIM,
    epoch' = 0,
    heirStatus' = HEIRS.mapBy(_ => "Open"),
    reopened' = HEIRS.mapBy(_ => false),
    reopenedAt' = HEIRS.mapBy(_ => -1),
    adultAt' = HEIRS.mapBy(_ => -1),
    payouts' = [],
    committed' = 0,
    nextNonce' = 0,
    falseRevert' = false,
    wishesRequested' = false,
    signerRegistered' = false,
    chainNonce' = 0,
    landings' = [],
    baseFee' = INITIAL_FEE,
    funded' = true,
    inflight' = Set(),
    calleeGasOk' = true,
    signOk' = true,
    attestOk' = true,
    ckdOk' = true,
    ownerAlive' = true,
    honestWitnesses' = true,
    lastAction' = if (TRACE) "init" else "",
    lastArgs' = [],
  }

  // ---------------------------------------------------------------- contract methods
  // I9: cancels a normal claim until the first payout exists. I10: never an override claim.
  action checkIn = all {
    ownerAlive,
    // I9, I20: a normal claim is cancelled only before the first payout and before the wishes key.
    if (claim.kind == "Normal") payouts.length() == 0 and not(wishesRequested) else true,
    lastCheckIn' = now,
    if (claim.kind == "Normal") all { claim' = NO_CLAIM, epoch' = epoch + 1, epoch < MAX_EPOCH + 1 }
    else all { claim' = claim, epoch' = epoch },
    heirStatus' = heirStatus, reopened' = reopened, reopenedAt' = reopenedAt, adultAt' = adultAt, payouts' = payouts,
    committed' = committed, nextNonce' = nextNonce, falseRevert' = falseRevert,
    wishesRequested' = wishesRequested, signerRegistered' = signerRegistered,
    now' = now, inflight' = inflight, keepEnv, record("check_in", []),
  }

  // An override opened by a quorum short of every witness waits twice as long (outside review F2).
  action openClaim(overrideClaim: bool, unanimous: bool): bool = all {
    not(claimOpen),
    epoch <= MAX_EPOCH,
    // An honest quorum only signs once the owner is dead. A lying one signs anything.
    honestWitnesses implies not(ownerAlive),
    if (overrideClaim) true else now - lastCheckIn >= INACTIVITY,
    val delay = if (not(overrideClaim)) GRACE else if (unanimous) OVERRIDE_GRACE else 2 * OVERRIDE_GRACE
    claim' = {
      kind: if (overrideClaim) "Override" else "Normal",
      openedAt: now,
      payAfter: now + delay,
      contested: Set(),
      frozenUntil: 0,
      freezeUsed: false,
      delay: delay,
    },
    lastCheckIn' = lastCheckIn, epoch' = epoch, heirStatus' = heirStatus, reopened' = reopened, reopenedAt' = reopenedAt,
    adultAt' = adultAt, payouts' = payouts, committed' = committed, nextNonce' = nextNonce,
    falseRevert' = falseRevert, wishesRequested' = wishesRequested, signerRegistered' = signerRegistered,
    now' = now, inflight' = inflight, keepEnv,
    record("open_claim", [if (overrideClaim) 1 else 0, if (unanimous) 1 else 0]),
  }

  // D20: after ABANDON of silence, anyone opens a normal claim with no witnesses.
  action openClaimAbandoned = all {
    not(claimOpen),
    epoch <= MAX_EPOCH,
    now - lastCheckIn >= ABANDON,
    claim' = { kind: "Normal", openedAt: now, payAfter: now + GRACE, contested: Set(), frozenUntil: 0, freezeUsed: false, delay: GRACE },
    lastCheckIn' = lastCheckIn, epoch' = epoch, heirStatus' = heirStatus, reopened' = reopened, reopenedAt' = reopenedAt,
    adultAt' = adultAt, payouts' = payouts, committed' = committed, nextNonce' = nextNonce,
    falseRevert' = falseRevert, wishesRequested' = wishesRequested, signerRegistered' = signerRegistered,
    now' = now, inflight' = inflight, keepEnv,
    record("open_claim_abandoned", []),
  }

  // I10: only the cold recovery key cancels an override claim, and only before payout.
  action cancelOverride = all {
    ownerAlive,
    claim.kind == "Override",
    payouts.length() == 0,
    not(wishesRequested),
    epoch < MAX_EPOCH + 1,
    claim' = NO_CLAIM, epoch' = epoch + 1, lastCheckIn' = now,
    heirStatus' = heirStatus, reopened' = reopened, reopenedAt' = reopenedAt, adultAt' = adultAt, payouts' = payouts,
    committed' = committed, nextNonce' = nextNonce, falseRevert' = falseRevert,
    wishesRequested' = wishesRequested, signerRegistered' = signerRegistered,
    now' = now, inflight' = inflight, keepEnv, record("cancel_override", []),
  }

  // I16
  action contest(w: int): bool = all {
    claimOpen,
    not(claim.contested.contains(w)),
    // Outside review F6: only during grace.
    now < claim.payAfter,
    claim' = claim.with("contested", claim.contested.union(Set(w))).with("payAfter", claim.payAfter + CONTEST),
    lastCheckIn' = lastCheckIn, epoch' = epoch, heirStatus' = heirStatus, reopened' = reopened, reopenedAt' = reopenedAt,
    adultAt' = adultAt, payouts' = payouts, committed' = committed, nextNonce' = nextNonce,
    falseRevert' = falseRevert, wishesRequested' = wishesRequested, signerRegistered' = signerRegistered,
    now' = now, inflight' = inflight, keepEnv, record("contest_claim", [w]),
  }

  // I11: the registrar can name any time, but only once per heir.
  action proveAdult(h: int, t: int): bool = all {
    adultAt.get(h) < 0,
    adultAt' = adultAt.set(h, t),
    lastCheckIn' = lastCheckIn, claim' = claim, epoch' = epoch, heirStatus' = heirStatus,
    reopened' = reopened, reopenedAt' = reopenedAt, payouts' = payouts, committed' = committed, nextNonce' = nextNonce,
    falseRevert' = falseRevert, wishesRequested' = wishesRequested, signerRegistered' = signerRegistered,
    now' = now, inflight' = inflight, keepEnv, record("prove_adult", [h, t]),
  }

  // I12
  action freeze = all {
    claimOpen,
    not(claim.freezeUsed),
    claim' = claim.with("freezeUsed", true).with("frozenUntil", now + FREEZE_MAX),
    lastCheckIn' = lastCheckIn, epoch' = epoch, heirStatus' = heirStatus, reopened' = reopened, reopenedAt' = reopenedAt,
    adultAt' = adultAt, payouts' = payouts, committed' = committed, nextNonce' = nextNonce,
    falseRevert' = falseRevert, wishesRequested' = wishesRequested, signerRegistered' = signerRegistered,
    now' = now, inflight' = inflight, keepEnv, record("freeze", []),
  }

  // Owner before a claim; afterwards a witness quorum.
  action registerSigner = all {
    not(signerRegistered),
    signerRegistered' = true,
    lastCheckIn' = lastCheckIn, claim' = claim, epoch' = epoch, heirStatus' = heirStatus,
    reopened' = reopened, reopenedAt' = reopenedAt, adultAt' = adultAt, payouts' = payouts, committed' = committed,
    nextNonce' = nextNonce, falseRevert' = falseRevert, wishesRequested' = wishesRequested,
    now' = now, inflight' = inflight, keepEnv, record("register_signer", []),
  }

  // I2, I7, I8: shared by the agent path and the fallback path. Starts attempt 0 at the initial fee.
  action createPayout(h: int, value: int, source: str): bool = all {
    triggerProven(h),
    // Outside review F1: a retry waits so anyone can first prove the original landed.
    reopenedAt.get(h) < 0 or now >= reopenedAt.get(h) + REOPEN_DELAY,
    committed + reserve(value) <= BUDGET,
    payouts' = payouts.append({
      heir: h, value: value, nonce: nextNonce, status: "Active", signing: true, signingSince: now,
      attempts: [{ fee: INITIAL_FEE, signed: false, requestedAt: now, public: false }], settledAttempt: -1, source: source,
    }),
    committed' = committed + reserve(value),
    nextNonce' = nextNonce + 1,
    heirStatus' = heirStatus.set(h, "Pending"),
    lastCheckIn' = lastCheckIn, claim' = claim, epoch' = epoch, reopened' = reopened, reopenedAt' = reopenedAt,
    adultAt' = adultAt, falseRevert' = falseRevert, wishesRequested' = wishesRequested,
    signerRegistered' = signerRegistered,
    now' = now, inflight' = inflight.union(Set(("sign", payouts.length(), now))), keepEnv,
  }

  // I14: the agent needs a registered signer; the bound is floor and cap whatever it signs.
  action proposePayout(h: int, value: int): bool = all {
    signerRegistered,
    createPayout(h, value, "agent"),
    record("propose_payout", [h, value]),
  }

  // I13
  action executeFallback(h: int): bool = all {
    claimOpen,
    now >= claim.openedAt + FALLBACK,
    createPayout(h, CAP, "fallback"),
    record("execute_fallback", [h]),
  }

  // I6: anyone re-prices. Same nonce, recipient, value. Fee doubles or reaches the ceiling.
  // D11: a request still marked in flight after LEASE is presumed lost and may be replaced. The lost
  // attempt is kept: if the MPC network did sign it, anyone can submit that signature.
  def keptAttempts(p) = payouts[p].attempts
  action requestSignature(p: int, fee: int): bool = all {
    p < payouts.length(),
    notFrozen,
    payouts[p].status == "Active",
    not(payouts[p].signing) or now >= payouts[p].signingSince + LEASE,
    fee <= CEILING,
    val kept = keptAttempts(p)
    all {
      if (kept.length() == 0) fee >= INITIAL_FEE
      else fee >= min(2 * kept[kept.length() - 1].fee, CEILING) and fee > kept[kept.length() - 1].fee,
      payouts' = payouts.replaceAt(p, payouts[p]
        .with("signing", true)
        .with("signingSince", now)
        .with("attempts", kept.append({ fee: fee, signed: false, requestedAt: now, public: false }))),
    },
    lastCheckIn' = lastCheckIn, claim' = claim, epoch' = epoch, heirStatus' = heirStatus,
    reopened' = reopened, reopenedAt' = reopenedAt, adultAt' = adultAt, committed' = committed, nextNonce' = nextNonce,
    falseRevert' = falseRevert, wishesRequested' = wishesRequested, signerRegistered' = signerRegistered,
    now' = now, inflight' = inflight.union(Set(("sign", p, now))), keepEnv, record("request_signature", [p, fee]),
  }

  // I5, I18: the MPC callback. A valid signature is stored; anything else drops the attempt.
  // A callback for a request that was replaced after its lease is ignored.
  def attemptAt(p, t) = payouts[p].attempts.indices().filter(a => payouts[p].attempts[a].requestedAt == t)
  def markPublic(p, t) = payouts.replaceAt(p, payouts[p].with("attempts",
    payouts[p].attempts.foldl([], (acc, x) => acc.append(if (x.requestedAt == t and not(x.signed)) x.with("public", true) else x))))

  action onSigned(p: int, t: int, ok: bool): bool = all {
    p < payouts.length(),
    inflight.contains(("sign", p, t)),
    ok implies signOk,
    val current = payouts[p].signing and payouts[p].signingSince == t
    val last = payouts[p].attempts.length() - 1
    val kept = if (ok) payouts[p].attempts.replaceAt(last, payouts[p].attempts[last].with("signed", true))
               else payouts[p].attempts.slice(0, last)
    // A stale callback is ignored by the vault, but a signature it carries is public.
    payouts' = if (current) payouts.replaceAt(p, payouts[p].with("signing", false).with("attempts", kept))
               else if (ok) markPublic(p, t) else payouts,
    lastCheckIn' = lastCheckIn, claim' = claim, epoch' = epoch, heirStatus' = heirStatus,
    reopened' = reopened, reopenedAt' = reopenedAt, adultAt' = adultAt, committed' = committed, nextNonce' = nextNonce,
    falseRevert' = falseRevert, wishesRequested' = wishesRequested, signerRegistered' = signerRegistered,
    now' = now, inflight' = inflight.exclude(Set(("sign", p, t))), keepEnv,
    record("on_signed", [p, t, if (ok) 1 else 0]),
  }

  // A callback that runs out of gas or storage rolls back: the vault records nothing. If the MPC
  // network had signed, that signature is public in its response.
  action callbackLost(p: int, t: int, mpcSigned: bool): bool = all {
    not(calleeGasOk),
    inflight.contains(("sign", p, t)),
    mpcSigned implies signOk,
    inflight' = inflight.exclude(Set(("sign", p, t))),
    payouts' = if (mpcSigned) markPublic(p, t) else payouts,
    lastCheckIn' = lastCheckIn, claim' = claim, epoch' = epoch, heirStatus' = heirStatus,
    reopened' = reopened, reopenedAt' = reopenedAt, adultAt' = adultAt, committed' = committed, nextNonce' = nextNonce,
    falseRevert' = falseRevert, wishesRequested' = wishesRequested, signerRegistered' = signerRegistered,
    now' = now, keepEnv, record("on_signed_lost", [p, t, if (mpcSigned) 1 else 0]),
  }

  // Outside review F4: anyone stores a public signature for an attempt no callback will deliver.
  action submitSignature(p: int, a: int): bool = all {
    p < payouts.length(),
    a < payouts[p].attempts.length(),
    payouts[p].attempts[a].public,
    not(payouts[p].attempts[a].signed),
    // Submitting the in-flight attempt's signature also ends that request.
    val inFlight = payouts[p].signing and a == payouts[p].attempts.length() - 1
    payouts' = payouts.replaceAt(p, payouts[p]
      .with("signing", payouts[p].signing and not(inFlight))
      .with("attempts", payouts[p].attempts.replaceAt(a, payouts[p].attempts[a].with("signed", true)))),
    lastCheckIn' = lastCheckIn, claim' = claim, epoch' = epoch, heirStatus' = heirStatus,
    reopened' = reopened, reopenedAt' = reopenedAt, adultAt' = adultAt, committed' = committed, nextNonce' = nextNonce,
    falseRevert' = falseRevert, wishesRequested' = wishesRequested, signerRegistered' = signerRegistered,
    now' = now, inflight' = inflight, keepEnv, record("submit_signature", [p, a]),
  }

  // I4: anyone asks the MPC network to attest a signed attempt.
  action settle(p: int, a: int): bool = all {
    p < payouts.length(),
    a < payouts[p].attempts.length(),
    payouts[p].attempts[a].signed,
    not(inflight.contains(("settle", p, a))),
    inflight' = inflight.union(Set(("settle", p, a))),
    now' = now, keepContract, keepEnv, record("settle", [p, a]),
  }

  // I3, I4, I17: the MPC network attests only a finalized successful landing of this exact attempt.
  action onSettled(p: int, a: int, attested: bool): bool = all {
    inflight.contains(("settle", p, a)),
    attested implies (attestOk and landedOk(p, a)),
    inflight' = inflight.exclude(Set(("settle", p, a))),
    if (attested) all {
      payouts' = payouts.replaceAt(p, payouts[p].with("status", "Settled").with("settledAttempt", a)),
      heirStatus' = heirStatus.set(payouts[p].heir, "Paid"),
      falseRevert' = (falseRevert or payouts[p].status == "Reverted"),
      // I7: a disproved revert's value left the vault after all.
      committed' = if (payouts[p].status == "Reverted") committed + payouts[p].value else committed,
    } else all {
      payouts' = payouts, heirStatus' = heirStatus, falseRevert' = falseRevert, committed' = committed,
    },
    lastCheckIn' = lastCheckIn, claim' = claim, epoch' = epoch, reopened' = reopened, reopenedAt' = reopenedAt,
    adultAt' = adultAt, nextNonce' = nextNonce,
    wishesRequested' = wishesRequested, signerRegistered' = signerRegistered,
    now' = now, keepEnv, record("on_settled", [p, a, if (attested) 1 else 0]),
  }

  // I17: a witness quorum reopens a reverted payout once per heir. Honest witnesses only do it
  // for a real revert; a lying quorum can do it for any signed attempt.
  action reopenReverted(p: int, a: int): bool = all {
    p < payouts.length(),
    not(falseRevert),
    payouts[p].status == "Active",
    a < payouts[p].attempts.length(),
    payouts[p].attempts[a].signed,
    not(reopened.get(payouts[p].heir)),
    honestWitnesses implies revertedOnChain(p, a),
    val h = payouts[p].heir
    all {
      payouts' = payouts.replaceAt(p, payouts[p].with("status", "Reverted").with("settledAttempt", a)),
      committed' = committed - payouts[p].value,
      heirStatus' = heirStatus.set(h, "Open"),
      reopened' = reopened.set(h, true),
      reopenedAt' = reopenedAt.set(h, now),
    },
    lastCheckIn' = lastCheckIn, claim' = claim, epoch' = epoch, adultAt' = adultAt,
    nextNonce' = nextNonce, falseRevert' = falseRevert, wishesRequested' = wishesRequested,
    signerRegistered' = signerRegistered,
    now' = now, inflight' = inflight, keepEnv, record("reopen_reverted", [p, a]),
  }

  // I15
  action requestWishesKey = all {
    matured,
    ckdOk,
    wishesRequested' = true,
    lastCheckIn' = lastCheckIn, claim' = claim, epoch' = epoch, heirStatus' = heirStatus,
    reopened' = reopened, reopenedAt' = reopenedAt, adultAt' = adultAt, payouts' = payouts, committed' = committed,
    nextNonce' = nextNonce, falseRevert' = falseRevert, signerRegistered' = signerRegistered,
    now' = now, inflight' = inflight, keepEnv, record("request_wishes_key", []),
  }

  // ---------------------------------------------------------------- environment steps
  action envStep(name: str, args: List[int]): bool = all {
    keepContract, inflight' = inflight, record(name, args),
  }

  action tick = all {
    now < MAX_TIME,
    now' = now + 1,
    keepEnv, keepContract, inflight' = inflight, record("tick", []),
  }

  // Base includes a stored signed attempt for the next nonce, if the fee clears and ETH is there.
  // `ok = false` is a revert: the nonce is consumed, the value is not moved.
  action land(p: int, a: int, ok: bool): bool = all {
    p < payouts.length(),
    a < payouts[p].attempts.length(),
    payouts[p].attempts[a].signed or payouts[p].attempts[a].public,
    payouts[p].nonce == chainNonce,
    payouts[p].attempts[a].fee >= baseFee,
    funded,
    chainNonce' = chainNonce + 1,
    landings' = landings.append({ payout: p, attempt: a, ok: ok, finalized: false }),
    baseFee' = baseFee, funded' = funded, signOk' = signOk, attestOk' = attestOk, ckdOk' = ckdOk, calleeGasOk' = calleeGasOk,
    ownerAlive' = ownerAlive, honestWitnesses' = honestWitnesses,
    now' = now, envStep("base_land", [p, a, if (ok) 1 else 0]),
  }

  // A reorg before finality drops the newest unfinalized landing and frees its nonce.
  action reorg = all {
    landings.length() > 0,
    not(landings[landings.length() - 1].finalized),
    landings' = landings.slice(0, landings.length() - 1),
    chainNonce' = chainNonce - 1,
    baseFee' = baseFee, funded' = funded, signOk' = signOk, attestOk' = attestOk, ckdOk' = ckdOk, calleeGasOk' = calleeGasOk,
    ownerAlive' = ownerAlive, honestWitnesses' = honestWitnesses,
    now' = now, envStep("base_reorg", []),
  }

  // Finality advances in order.
  action finalize = all {
    val i = landings.indices().filter(j => not(landings[j].finalized))
    all {
      i.size() > 0,
      val first = i.fold(landings.length(), (m, j) => min(m, j))
      landings' = landings.replaceAt(first, landings[first].with("finalized", true)),
    },
    chainNonce' = chainNonce, baseFee' = baseFee, funded' = funded, signOk' = signOk,
    attestOk' = attestOk, ckdOk' = ckdOk, calleeGasOk' = calleeGasOk, ownerAlive' = ownerAlive, honestWitnesses' = honestWitnesses,
    now' = now, envStep("base_finalize", []),
  }

  action setBaseFee(f: int): bool = all {
    baseFee' = f,
    chainNonce' = chainNonce, landings' = landings, funded' = funded, signOk' = signOk,
    attestOk' = attestOk, ckdOk' = ckdOk, calleeGasOk' = calleeGasOk, ownerAlive' = ownerAlive, honestWitnesses' = honestWitnesses,
    now' = now, envStep("base_fee", [f]),
  }

  action ownerDies = all {
    ownerAlive,
    ownerAlive' = false,
    chainNonce' = chainNonce, landings' = landings, baseFee' = baseFee, funded' = funded,
    signOk' = signOk, attestOk' = attestOk, ckdOk' = ckdOk, calleeGasOk' = calleeGasOk, honestWitnesses' = honestWitnesses,
    now' = now, envStep("owner_dies", []),
  }

  // From here on any quorum signs anything the contract accepts.
  action witnessesLie = all {
    honestWitnesses,
    honestWitnesses' = false,
    chainNonce' = chainNonce, landings' = landings, baseFee' = baseFee, funded' = funded,
    signOk' = signOk, attestOk' = attestOk, ckdOk' = ckdOk, calleeGasOk' = calleeGasOk, ownerAlive' = ownerAlive,
    now' = now, envStep("witnesses_lie", []),
  }

  // D*: dependency failures from docs/evidence/deps/. Each is permanent once it happens.
  action depFail(which: str): bool = all {
    signOk' = if (which == "sign") false else signOk,
    attestOk' = if (which == "attest") false else attestOk,
    ckdOk' = if (which == "ckd") false else ckdOk,
    calleeGasOk' = if (which == "callback_gas") false else calleeGasOk,
    funded' = if (which == "unfunded") false else funded,
    chainNonce' = chainNonce, landings' = landings, baseFee' = baseFee,
    ownerAlive' = ownerAlive, honestWitnesses' = honestWitnesses,
    now' = now, envStep("dep_fail", []),
  }

  action contractStep = any {
    checkIn,
    nondet k = Set(true, false).oneOf()
    nondet u = Set(true, false).oneOf()
    openClaim(k, u),
    cancelOverride,
    nondet w = WITNESSES.oneOf()
    contest(w),
    nondet h = HEIRS.oneOf()
    // Before, between and after the two heirs' adult_by times.
    nondet t = Set(0, 2, MAX_TIME).oneOf()
    proveAdult(h, t),
    freeze,
    registerSigner,
    nondet h = HEIRS.oneOf()
    nondet v = VALUES.oneOf()
    proposePayout(h, v),
    nondet h = HEIRS.oneOf()
    executeFallback(h),
    nondet p = PAYOUT_IDS.oneOf()
    nondet f = FEES.oneOf()
    requestSignature(p, f),
    nondet p = PAYOUT_IDS.oneOf()
    nondet t = 0.to(MAX_TIME).oneOf()
    nondet ok = Set(true, false).oneOf()
    onSigned(p, t, ok),
    nondet p = PAYOUT_IDS.oneOf()
    nondet a = 0.to(3).oneOf()
    settle(p, a),
    nondet p = PAYOUT_IDS.oneOf()
    nondet a = 0.to(3).oneOf()
    nondet ok = Set(true, false).oneOf()
    onSettled(p, a, ok),
    nondet p = PAYOUT_IDS.oneOf()
    nondet a = 0.to(3).oneOf()
    reopenReverted(p, a),
    requestWishesKey,
    nondet p = PAYOUT_IDS.oneOf()
    nondet t = 0.to(MAX_TIME).oneOf()
    nondet sg = Set(true, false).oneOf()
    callbackLost(p, t, sg),
    openClaimAbandoned,
    nondet p = PAYOUT_IDS.oneOf()
    nondet a = 0.to(3).oneOf()
    submitSignature(p, a),
  }

  action baseStep = any {
    tick,
    nondet p = PAYOUT_IDS.oneOf()
    nondet a = 0.to(3).oneOf()
    nondet ok = Set(true, false).oneOf()
    land(p, a, ok),
    reorg,
    finalize,
    // The initial fee clears, only a re-priced fee clears, or nothing under the ceiling clears.
    nondet f = Set(INITIAL_FEE, 2 * INITIAL_FEE, CEILING + 1).oneOf()
    setBaseFee(f),
    ownerDies,
    witnessesLie,
  }

  // Everything, including dependency failures and lying witnesses.
  action step = any {
    contractStep,
    baseStep,
    nondet d = Set("sign", "attest", "ckd", "unfunded", "callback_gas").oneOf()
    depFail(d),
  }

  // No dependency failures: the steps traces are most often drawn from.
  action stepLive = any { contractStep, baseStep }

  // ---------------------------------------------------------------- safety invariants
  def heirPayouts(h) = payoutIdx.filter(p => payouts[p].heir == h)
  def successfulLandings(h) = landings.indices().filter(i => landings[i].ok and payouts[landings[i].payout].heir == h)
  def onChainPaid(h) = successfulLandings(h).fold(0, (s, i) => s + payouts[landings[i].payout].value)

  // I2
  val inv_bounds = payoutIdx.forall(p => HEIRS.contains(payouts[p].heir) and payouts[p].value >= FLOOR and payouts[p].value <= CAP)

  // I3: Paid implies a settled payout for that heir; a heir has at most one live payout. The one
  // exception is the stated limit of I17: a lying quorum's reopen, disproved after the retry was
  // issued, leaves that heir with a settled payout and a live retry (tlc-v2-cex-stated-overpay.log).
  val inv_paid_once = HEIRS.forall(h => and {
    heirStatus.get(h) == "Paid" implies heirPayouts(h).exists(p => payouts[p].status == "Settled"),
    heirPayouts(h).filter(p => payouts[p].status != "Reverted").size() <= (if (falseRevert) 2 else 1),
    honestWitnesses implies heirPayouts(h).filter(p => payouts[p].status != "Reverted").size() <= 1,
  })

  // I4: a settled payout landed successfully and finalized, exactly as settled.
  val inv_settled_landed = payoutIdx.forall(p => payouts[p].status == "Settled" implies landedOk(p, payouts[p].settledAttempt))

  // I6: one nonce per payout, distinct across payouts, all attempts share it; at most one landing per nonce.
  val inv_nonces = and {
    payoutIdx.forall(p => payouts[p].nonce == p),
    nextNonce == payouts.length(),
    landings.indices().forall(i => payouts[landings[i].payout].nonce == i),
  }

  // I7. After a disproved revert the overpaid value counts again, so committed may pass the budget
  // by that one payout: the stated limit of I17, made visible (tlc-v3-cex-budget-after-false-revert.log).
  val inv_budget = and {
    committed <= BUDGET + (if (falseRevert) CAP else 0),
    honestWitnesses implies committed <= BUDGET,
    committed == payoutIdx.fold(0, (s, p) => s + payouts[p].value + CEILING - (if (payouts[p].status == "Reverted") payouts[p].value else 0)),
  }

  // I9, I10: a claim with payouts is never cancelled.
  val inv_claim_sticks = payouts.length() > 0 implies claimOpen

  // I12
  val inv_freeze = claimOpen implies (claim.frozenUntil <= now + FREEZE_MAX)

  // I16
  val inv_contest = claimOpen implies and {
    claim.payAfter == claim.openedAt + claim.delay + CONTEST * claim.contested.size(),
    claim.delay == (if (claim.kind == "Normal") GRACE else OVERRIDE_GRACE) or (claim.kind == "Override" and claim.delay == 2 * OVERRIDE_GRACE),
  }

  // I17: once per heir; a lying quorum overpays at most once, and only that heir.
  val inv_reopen = HEIRS.forall(h => and {
    heirPayouts(h).filter(p => payouts[p].status == "Reverted").size() <= 1,
    successfulLandings(h).size() <= (if (reopened.get(h)) 2 else 1),
    honestWitnesses implies successfulLandings(h).size() <= 1,
  })

  // Chain-level: the money that left the vault never exceeds the budget.
  val inv_spent = HEIRS.fold(0, (s, h) => s + onChainPaid(h)) <= BUDGET

  // I15
  val inv_wishes = wishesRequested implies claimOpen

  // I19: the nonce Base waits for always belongs to a payout that can still produce a transaction:
  // either it is active (re-signable) or it has a stored signed attempt.
  val inv_nonce_live = chainNonce < nextNonce implies (
    payouts[chainNonce].status == "Active" or payouts[chainNonce].attempts.select(x => x.signed or x.public).length() > 0
  )

  // Liveness guard as a state predicate: a payout marked as signing always has a callback coming.
  val inv_signing_has_callback = payoutIdx.forall(p => payouts[p].signing implies inflight.contains(("sign", p, payouts[p].signingSince)))

  // v3: every invariant. `inv_signing_has_callback` is gone: a lost callback is now recovered after
  // LEASE (liveness, below), so its absence is no longer a stuck state.
  val safety = and {
    inv_bounds, inv_paid_once, inv_settled_landed, inv_nonces, inv_budget, inv_claim_sticks,
    inv_freeze, inv_contest, inv_reopen, inv_spent, inv_wishes, inv_nonce_live,
  }

  // ---------------------------------------------------------------- liveness
  // Fair world: the owner has died, witnesses are honest, no dependency fails, Base's fee stays
  // under the ceiling, and no reorg repeats forever. Heirs' contracts may still revert.
  // Time is bounded for the checker. These two guards keep every deadline inside the horizon:
  // time waits at INACTIVITY until the claim opens, and the court's one freeze must end by MAX_TIME.
  // After that, every later time is equivalent for the vault, so the bound hides no behaviour.
  action tickFair = all { claimOpen or now < INACTIVITY, tick }
  action freezeFair = all { now + FREEZE_MAX <= MAX_TIME, freeze }

  // The no-AI path: a normal claim and the fallback. The agent is optional, so liveness must hold
  // without it; contests, the freeze, signing failures, reverts and settlement timeouts stay in.
  action fairContract = any {
    nondet u = Set(true, false).oneOf()
    openClaim(false, u),
    nondet w = WITNESSES.oneOf()
    contest(w),
    freezeFair,
    nondet h = HEIRS.oneOf()
    executeFallback(h),
    nondet p = PAYOUT_IDS.oneOf()
    nondet f = FEES.oneOf()
    requestSignature(p, f),
    nondet p = PAYOUT_IDS.oneOf()
    nondet t = 0.to(MAX_TIME).oneOf()
    nondet ok = Set(true, false).oneOf()
    onSigned(p, t, ok),
    nondet p = PAYOUT_IDS.oneOf()
    nondet a = 0.to(3).oneOf()
    settle(p, a),
    nondet p = PAYOUT_IDS.oneOf()
    nondet a = 0.to(3).oneOf()
    nondet ok = Set(true, false).oneOf()
    onSettled(p, a, ok),
    nondet p = PAYOUT_IDS.oneOf()
    nondet a = 0.to(3).oneOf()
    reopenReverted(p, a),
    nondet p = PAYOUT_IDS.oneOf()
    nondet a = 0.to(3).oneOf()
    submitSignature(p, a),
  }

  action fairBase = any {
    tickFair,
    nondet p = PAYOUT_IDS.oneOf()
    nondet a = 0.to(3).oneOf()
    nondet ok = Set(true, false).oneOf()
    land(p, a, ok),
    finalize,
    ownerDies,
  }

  action stepFair = any { fairContract, fairBase }

  def vars = (now, lastCheckIn, claim, epoch, heirStatus, reopened, reopenedAt, adultAt, payouts, committed, nextNonce,
    falseRevert, wishesRequested, signerRegistered, chainNonce, landings, baseFee, funded, inflight, signOk,
    attestOk, ckdOk, calleeGasOk, ownerAlive, honestWitnesses, lastAction, lastArgs)

  // What "someone eventually does it" means for each actor. Strong fairness where a step can fail
  // and be retried forever (the MPC network answering, Base including a transaction).
  temporal fairness = and {
    weakFair(tickFair, vars),
    weakFair(ownerDies, vars),
    weakFair(openClaim(false, false), vars),
    HEIRS.forall(h => weakFair(executeFallback(h), vars)),
    PAYOUT_IDS.forall(p => strongFair(0.to(MAX_TIME).exists(t => onSigned(p, t, true)), vars)),
    PAYOUT_IDS.forall(p => weakFair(FEES.exists(f => requestSignature(p, f)), vars)),
    PAYOUT_IDS.forall(p => strongFair(0.to(3).exists(a => land(p, a, true) or land(p, a, false)), vars)),
    weakFair(finalize, vars),
    // Per attempt: a relayer that keeps settling an attempt that never landed is not fair
    // (tlc-v3-tiny-liveness-fairness-artifact.log). It must try the one that did.
    PAYOUT_IDS.forall(p => 0.to(3).forall(a => weakFair(settle(p, a), vars))),
    PAYOUT_IDS.forall(p => 0.to(3).forall(a => strongFair(onSettled(p, a, true), vars))),
    PAYOUT_IDS.forall(p => weakFair(0.to(3).exists(a => reopenReverted(p, a)), vars)),
    // Someone submits a public signature the vault never stored (tlc-v3-tiny-liveness-cex-public-signature.log).
    PAYOUT_IDS.forall(p => 0.to(3).forall(a => weakFair(submitSignature(p, a), vars))),
  }

  // Each heir is eventually paid, or reopened after a real revert.
  temporal liveness = fairness implies HEIRS.forall(h => eventually(heirStatus.get(h) == "Paid" or reopened.get(h)))
}
