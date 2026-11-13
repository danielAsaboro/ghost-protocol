//! Replays model traces from `spec/ghost.qnt` against the contract (ITF, Informal Trace Format).
//! Each trace step names the action the model took; the contract performs the same call, and
//! afterwards the contract's state, projected onto the model's variables, must equal the model's.
//! Traces: `spec/traces/*.itf.json`, produced by `spec/gen-traces.sh`.

use super::test_support::*;
use super::*;
use near_sdk::serde_json::Value;

/// One model time unit, in seconds. Equal to SIGN_LEASE_SECS and REOPEN_DELAY_SECS, so the model's
/// LEASE and REOPEN_DELAY of 1 are the contract's.
const UNIT: u64 = SIGN_LEASE_SECS;
const _: () = assert!(SIGN_LEASE_SECS == REOPEN_DELAY_SECS);
/// One model value unit, in wei: the gas limit, so a reserve is `value + CEILING` units.
const WEI: u128 = 21_000;
const M_CEILING: u128 = 4;
const M_CAP: u128 = 3;
const M_FLOOR: u128 = 2;

fn secs(t: u64) -> u64 {
    START + t * UNIT
}

fn model_config() -> VaultConfig {
    let mut c = config();
    c.inactivity_secs = 2 * UNIT;
    c.grace_secs = UNIT;
    c.override_grace_secs = 2 * UNIT;
    c.contest_secs = UNIT;
    c.freeze_max_secs = UNIT;
    c.fallback_secs = 9 * UNIT;
    c.abandon_secs = Some(4 * UNIT);
    c.initial_max_fee_per_gas = U128(1);
    c.max_fee_ceiling = U128(M_CEILING);
    c.max_priority_fee_per_gas = U128(1);
    c.budget_wei = U128(2 * (M_CAP + 2 * M_CEILING) * WEI);
    let mut h0 = heir(HEIR);
    let mut h1 = heir(HEIR2);
    for (h, adult) in [(&mut h0, 0u64), (&mut h1, 4)] {
        h.floor_wei = U128(M_FLOOR * WEI);
        h.cap_wei = U128(M_CAP * WEI);
        h.adult_by = secs(adult);
    }
    c.heirs = vec![h0, h1];
    c
}

// ------------------------------------------------------------------ ITF decoding

fn int(v: &Value) -> i64 {
    match v {
        Value::Object(o) if o.contains_key("#bigint") => o["#bigint"].as_str().unwrap().parse().unwrap(),
        Value::Number(n) => n.as_i64().unwrap(),
        other => panic!("not an ITF int: {other}"),
    }
}

fn list(v: &Value) -> &Vec<Value> {
    v.as_array().unwrap_or_else(|| panic!("not an ITF list: {v}"))
}

fn set(v: &Value) -> &Vec<Value> {
    v["#set"].as_array().unwrap_or_else(|| panic!("not an ITF set: {v}"))
}

fn map_get<'a>(v: &'a Value, key: i64) -> &'a Value {
    v["#map"].as_array().unwrap().iter().find(|kv| int(&kv[0]) == key).map(|kv| &kv[1]).unwrap()
}

fn s(v: &Value) -> &str {
    v.as_str().unwrap()
}

// ------------------------------------------------------------------ projection

/// The contract state in the model's vocabulary, as a canonical JSON value.
fn project(v: &Vault) -> Value {
    let claim = match &v.claim {
        None => json!({ "kind": "None" }),
        Some(c) => json!({
            "kind": if c.kind == ClaimKind::Normal { "Normal" } else { "Override" },
            "openedAt": (c.opened_at - START) / UNIT,
            "payAfter": (c.pay_after - START) / UNIT,
            "contested": c.contested.iter().enumerate().filter(|(_, b)| **b).map(|(i, _)| i).collect::<Vec<_>>(),
            "frozenUntil": if c.frozen_until == 0 { 0 } else { (c.frozen_until - START) / UNIT },
            "freezeUsed": c.freeze_used,
        }),
    };
    let heirs: Vec<Value> = v
        .heirs
        .iter()
        .map(|h| {
            json!({
                "status": format!("{:?}", h.status),
                "reopened": h.reopened,
                "reopenedAt": h.reopened_at.map_or(-1, |t| ((t - START) / UNIT) as i64),
                "adultAt": h.adult_at.map_or(-1, |t| ((t - START) / UNIT) as i64),
            })
        })
        .collect();
    let payouts: Vec<Value> = v
        .payouts
        .iter()
        .map(|p| {
            json!({
                "heir": p.heir_index,
                "value": p.value_wei.0 / WEI,
                "nonce": p.nonce,
                "status": format!("{:?}", p.status),
                "signing": p.signing,
                "signingSince": if p.signing_since == 0 { 0 } else { (p.signing_since - START) / UNIT },
                "attempts": p.attempts.iter().map(|a| json!({ "fee": a.max_fee_per_gas.0, "signed": a.tx_hash_hex.is_some() })).collect::<Vec<_>>(),
                "settledAttempt": p.settled_attempt.map_or(-1, |a| a as i64),
                "source": p.source,
            })
        })
        .collect();
    json!({
        "lastCheckIn": (v.last_check_in - START) / UNIT,
        "claim": claim,
        "epoch": v.claim_epoch,
        "heirs": heirs,
        "payouts": payouts,
        "committed": v.committed_wei / WEI,
        "nextNonce": v.next_nonce,
        "falseRevert": v.false_revert_proven,
        "signerRegistered": !v.signers.is_empty(),
    })
}

/// The model state in the same shape.
fn model(state: &Value) -> Value {
    let c = &state["claim"];
    let claim = if s(&c["kind"]) == "None" {
        json!({ "kind": "None" })
    } else {
        let mut contested: Vec<i64> = set(&c["contested"]).iter().map(int).collect();
        contested.sort();
        json!({
            "kind": s(&c["kind"]),
            "openedAt": int(&c["openedAt"]),
            "payAfter": int(&c["payAfter"]),
            "contested": contested,
            "frozenUntil": int(&c["frozenUntil"]),
            "freezeUsed": c["freezeUsed"].as_bool().unwrap(),
        })
    };
    let heirs: Vec<Value> = (0..2)
        .map(|h| {
            json!({
                "status": s(map_get(&state["heirStatus"], h)),
                "reopened": map_get(&state["reopened"], h).as_bool().unwrap(),
                "reopenedAt": int(map_get(&state["reopenedAt"], h)),
                "adultAt": int(map_get(&state["adultAt"], h)),
            })
        })
        .collect();
    let payouts: Vec<Value> = list(&state["payouts"])
        .iter()
        .map(|p| {
            json!({
                "heir": int(&p["heir"]),
                "value": int(&p["value"]),
                "nonce": int(&p["nonce"]),
                "status": s(&p["status"]),
                "signing": p["signing"].as_bool().unwrap(),
                "signingSince": int(&p["signingSince"]),
                "attempts": list(&p["attempts"]).iter().map(|a| json!({ "fee": int(&a["fee"]), "signed": a["signed"].as_bool().unwrap() })).collect::<Vec<_>>(),
                "settledAttempt": int(&p["settledAttempt"]),
                "source": s(&p["source"]),
            })
        })
        .collect();
    json!({
        "lastCheckIn": int(&state["lastCheckIn"]),
        "claim": claim,
        "epoch": int(&state["epoch"]),
        "heirs": heirs,
        "payouts": payouts,
        "committed": int(&state["committed"]),
        "nextNonce": int(&state["nextNonce"]),
        "falseRevert": state["falseRevert"].as_bool().unwrap(),
        "signerRegistered": state["signerRegistered"].as_bool().unwrap(),
    })
}

// ------------------------------------------------------------------ actions

fn quorum_of(message: &str, witnesses: &[u32]) -> Vec<WitnessProof> {
    witnesses.iter().map(|w| proof(*w as u8 + 1, *w, message)).collect()
}

fn apply(v: &mut Vault, now: u64, action: &str, args: &[i64]) {
    let t = secs(now);
    let arg = |i: usize| args[i] as u32;
    match action {
        "check_in" => {
            at(t, "owner.testnet");
            v.check_in();
        }
        "open_claim" => {
            at(t, "anyone.testnet");
            let epoch = v.claim_epoch;
            if args[0] == 1 {
                let m = format!("ghost:override:{VAULT}:{epoch}:{t}");
                let who: &[u32] = if args[1] == 1 { &[0, 1, 2] } else { &[0, 1] };
                v.open_claim(t, quorum_of(&m, who), true);
            } else {
                v.open_claim(t, quorum_of(&death_message(epoch, t), &[0, 1]), false);
            }
        }
        "cancel_override" => {
            at(t, "anyone.testnet");
            let opened = v.claim.as_ref().unwrap().opened_at;
            v.cancel_override(signed(20, &format!("ghost:cancel:{VAULT}:{}:{opened}", v.claim_epoch)));
        }
        "contest_claim" => {
            at(t, "anyone.testnet");
            let opened = v.claim.as_ref().unwrap().opened_at;
            let w = arg(0);
            v.contest_claim(w, signed(w as u8 + 1, &format!("ghost:contest:{VAULT}:{}:{w}:{opened}", v.claim_epoch)));
        }
        "prove_adult" => {
            at(t, "anyone.testnet");
            let adult_at = secs(args[1] as u64);
            v.prove_adult(arg(0), adult_at, adult(arg(0), adult_at));
        }
        "freeze" => {
            at(t, "court.testnet");
            v.freeze();
        }
        "register_signer" => {
            at(t, "anyone.testnet");
            let address = enclave_address(ENCLAVE_KEY);
            let expires = u64::MAX / 2;
            let m = format!("ghost:signer:{VAULT}:{address}:q:{expires}");
            v.register_signer(address, "q".into(), expires, quorum_of(&m, &[0, 1]));
        }
        "propose_payout" => {
            at(t, "agent.testnet");
            let value = args[1] as u128 * WEI;
            v.propose_payout(arg(0), U128(value), decision(arg(0), value));
        }
        "execute_fallback" => {
            at(t, "anyone.testnet");
            v.execute_fallback(arg(0));
        }
        "request_signature" => {
            at(t, "anyone.testnet");
            v.request_signature(arg(0), U128(args[1] as u128));
        }
        "on_signed" => {
            at(t, VAULT);
            let p = arg(0) as usize;
            let requested_at = secs(args[1] as u64);
            let attempt = v.payouts[p].attempts.len().saturating_sub(1);
            let current = v.payouts[p].signing && v.payouts[p].signing_since == requested_at;
            let result = if args[2] == 1 && current { Ok(good_signature(v, p, attempt)) } else if args[2] == 1 {
                // A stale callback carries a signature over the replaced attempt's payload.
                Ok(mpc_sign(VAULT_KEY, &[7u8; 32]))
            } else {
                Err(PromiseError::Failed)
            };
            v.on_signed(p as u32, attempt as u32, requested_at, result);
        }
        "submit_signature" => {
            at(t, "anyone.testnet");
            let (p, a) = (arg(0) as usize, arg(1) as usize);
            let sig = good_signature(v, p, a);
            v.submit_signature(p as u32, a as u32, sig);
        }
        "open_claim_abandoned" => {
            at(t, "anyone.testnet");
            v.open_claim(t, vec![], false);
        }
        "settle" => {
            at(t, "anyone.testnet");
            v.settle(arg(0), arg(1));
        }
        "on_settled" => {
            at(t, VAULT);
            let result = if args[2] == 1 {
                Ok(attestation(v, arg(0) as usize, arg(1) as usize, FOREIGN_KEY))
            } else {
                Err(PromiseError::Failed)
            };
            v.on_settled(arg(0), arg(1), result);
        }
        "reopen_reverted" => {
            at(t, "anyone.testnet");
            let (p, a) = (arg(0), arg(1) as usize);
            let tx = v.payouts[p as usize].attempts[a].tx_hash_hex.clone().unwrap();
            let m = format!("ghost:reverted:{VAULT}:{p}:{tx}");
            v.reopen_reverted(p, a as u32, quorum_of(&m, &[0, 1]));
        }
        "request_wishes_key" => {
            at(t, "anyone.testnet");
            v.request_wishes_key();
        }
        // Clock, Base, actors' fates and dependency failures: no contract call. A lost callback
        // rolls back, so it is also no contract call.
        "tick" | "base_land" | "base_reorg" | "base_finalize" | "base_fee" | "owner_dies" | "witnesses_lie"
        | "dep_fail" | "on_signed_lost" => {}
        other => panic!("unmapped model action {other}"),
    }
}

/// Replays one trace. Returns the number of steps checked.
pub fn replay(trace: &Value) -> usize {
    let states = list(&trace["states"]);
    at(START, "owner.testnet");
    let mut v = Vault::new(model_config());
    assert_eq!(project(&v), model(&states[0]), "initial state differs");
    for (i, state) in states.iter().enumerate().skip(1) {
        let action = s(&state["lastAction"]);
        let args: Vec<i64> = list(&state["lastArgs"]).iter().map(int).collect();
        let now = int(&state["now"]) as u64;
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            apply(&mut v, now, action, &args);
            v
        }));
        v = match result {
            Ok(v) => v,
            Err(e) => {
                let msg = e.downcast_ref::<String>().cloned().unwrap_or_default();
                panic!("step {i}: model took {action}{args:?}, contract refused: {msg}");
            }
        };
        let (got, want) = (project(&v), model(state));
        assert_eq!(got, want, "step {i}: state differs after {action}{args:?}");
    }
    states.len() - 1
}

#[test]
fn model_traces_replay_on_the_contract() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../spec/traces");
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .unwrap_or_else(|_| panic!("no traces in {}; run spec/gen-traces.sh", dir.display()))
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.to_string_lossy().ends_with(".itf.json"))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no traces");
    let mut steps = 0;
    let mut actions = std::collections::BTreeMap::<String, usize>::new();
    for f in &files {
        let trace: Value = serde_json::from_str(&std::fs::read_to_string(f).unwrap()).unwrap();
        for st in list(&trace["states"]).iter().skip(1) {
            *actions.entry(s(&st["lastAction"]).to_string()).or_default() += 1;
        }
        steps += std::panic::catch_unwind(|| replay(&trace))
            .unwrap_or_else(|_| panic!("trace {} does not replay", f.display()));
    }
    println!("replayed {} traces, {steps} steps: {actions:?}", files.len());
}
