//! Every arithmetic expression the vault evaluates, as pure functions, so Kani can prove them.
//! `lib.rs` calls these and does no arithmetic of its own on amounts, times or counters.

/// Wei held back for one payout: its value plus one transaction at the fee ceiling.
pub fn reserve(value: u128, gas_limit: u64, ceiling: u128) -> u128 {
    value + gas_limit as u128 * ceiling
}

/// Budget a heir needs at init: its cap, the payment's gas, and one retry's gas after a revert.
pub fn heir_requirement(cap: u128, gas_limit: u64, ceiling: u128) -> u128 {
    cap + 2 * gas_limit as u128 * ceiling
}

/// `true` when a new reserve still fits the budget.
pub fn fits_budget(committed: u128, reserve: u128, budget: u128) -> bool {
    committed + reserve <= budget
}

/// The longest a claim can be held back before payout: grace, every contest, one freeze.
pub fn longest_delay(grace: u64, override_grace: u64, contest: u64, witnesses: usize, freeze_max: u64) -> u64 {
    override_grace.max(grace) + contest * witnesses as u64 + freeze_max
}

/// A deadline `delay` seconds after `now`.
pub fn after(now: u64, delay: u64) -> u64 {
    now + delay
}

/// Seconds since the owner's last check-in.
pub fn silence(now: u64, last_check_in: u64) -> u64 {
    now.saturating_sub(last_check_in)
}

/// The fee rule for a re-priced attempt: at most the ceiling, and either the first attempt at or
/// above the initial fee, or strictly higher than the last and at least double it or the ceiling.
pub fn fee_allowed(previous: Option<u128>, fee: u128, initial: u128, ceiling: u128) -> bool {
    if fee > ceiling {
        return false;
    }
    match previous {
        Some(prev) => fee >= prev.saturating_mul(2).min(ceiling) && fee > prev,
        None => fee >= initial,
    }
}

/// When a heir counts as adult: the registrar's date if earlier, never later than `adult_by`.
pub fn adult_time(adult_at: Option<u64>, adult_by: u64) -> u64 {
    adult_at.map_or(adult_by, |at| at.min(adult_by))
}

#[cfg(kani)]
mod proofs {
    use super::*;

    #[kani::proof]
    fn fee_rule_only_raises_and_never_passes_the_ceiling() {
        let (prev, fee, initial, ceiling): (u128, u128, u128, u128) = kani::any();
        let first: bool = kani::any();
        let previous = if first { None } else { Some(prev) };
        if fee_allowed(previous, fee, initial, ceiling) {
            assert!(fee <= ceiling);
            match previous {
                Some(p) => assert!(fee > p && (fee >= ceiling || fee / 2 >= p)),
                None => assert!(fee >= initial),
            }
        }
    }

    #[kani::proof]
    fn fee_rule_lets_a_stuck_payout_reach_the_ceiling() {
        // From any accepted fee below the ceiling, the ceiling itself is always an allowed next step.
        let (prev, ceiling): (u128, u128) = kani::any();
        kani::assume(prev < ceiling);
        assert!(fee_allowed(Some(prev), ceiling, 0, ceiling));
    }

    #[kani::proof]
    fn adult_time_is_never_later_than_adult_by() {
        let (at, by): (u64, u64) = kani::any();
        let some: bool = kani::any();
        let t = adult_time(if some { Some(at) } else { None }, by);
        assert!(t <= by);
        if some {
            assert!(t <= at);
        }
    }

    #[kani::proof]
    fn silence_never_underflows() {
        let (now, last): (u64, u64) = kani::any();
        let s = silence(now, last);
        assert!(s <= now);
    }

    /// Time. Assumptions are what `Vault::new` accepts (the release profile has overflow checks,
    /// so a config whose own sums overflow panics at init and is never deployed), plus a block time
    /// below 2^40 seconds (year 36,812). Kani checks every runtime time expression for overflow.
    #[kani::proof]
    #[kani::unwind(18)]
    fn time_arithmetic_cannot_overflow_for_any_accepted_config() {
        let (grace, override_grace, contest, freeze_max, fallback): (u64, u64, u64, u64, u64) = kani::any();
        let witnesses: usize = kani::any();
        kani::assume(witnesses >= 2 && witnesses <= 16);
        let Some(contests) = contest.checked_mul(witnesses as u64) else { return };
        let Some(delays) = override_grace.max(grace).checked_add(contests).and_then(|d| d.checked_add(freeze_max)) else { return };
        kani::assume(fallback > delays);
        let (now, later, opened_at): (u64, u64, u64) = kani::any();
        kani::assume(opened_at <= now && now <= later && later < 1 << 40);
        // open_claim, contest_claim by every witness, freeze, execute_fallback.
        let mut pay_after = after(now, override_grace.max(grace));
        for _ in 0..witnesses {
            pay_after = after(pay_after, contest);
        }
        let _ = after(later, freeze_max);
        let _ = after(opened_at, fallback);
    }

    /// Budget. Same assumption style: whatever `Vault::new` accepted for two heirs.
    #[kani::proof]
    fn budget_arithmetic_cannot_overflow_for_any_accepted_config() {
        let (cap0, cap1, ceiling, budget): (u128, u128, u128, u128) = kani::any();
        let (gas0, gas1): (u64, u64) = kani::any();
        kani::assume(gas0 >= 21_000 && gas0 <= 2_000_000 && gas1 >= 21_000 && gas1 <= 2_000_000);
        let need = |cap: u128, gas: u64| cap.checked_add((gas as u128).checked_mul(ceiling)?.checked_mul(2)?);
        let (Some(n0), Some(n1)) = (need(cap0, gas0), need(cap1, gas1)) else { return };
        let Some(required) = n0.checked_add(n1) else { return };
        kani::assume(required <= budget);
        // create_payout for heir 0 then heir 1, each at most its cap.
        let (v0, v1): (u128, u128) = kani::any();
        kani::assume(v0 <= cap0 && v1 <= cap1);
        let r0 = reserve(v0, gas0, ceiling);
        if fits_budget(0, r0, budget) {
            let r1 = reserve(v1, gas1, ceiling);
            let _ = fits_budget(r0, r1, budget);
        }
    }
}
