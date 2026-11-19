//! Reputation-weighted airdrop distribution (Issue #1553).
//!
//! The existing claim flow in [`crate`] pays every eligible address the same
//! amount — the per-claim amount baked into a Merkle leaf. This module adds
//! a second, proportional distribution: given a weight per recipient
//! (typically derived from reputation), each recipient's share of a total
//! supply is proportional to its weight, so a weight-2 recipient receives
//! exactly twice what a weight-1 recipient receives.
//!
//! Integer division cannot split a supply perfectly across arbitrary
//! weights, so [`compute_weighted_allocations`] uses the largest-remainder
//! method: every recipient first gets the floor of its proportional share,
//! and the units lost to flooring are handed out one at a time to the
//! recipients with the largest fractional remainder, until the total
//! distributed is exactly `total_supply` — never more, never less.

use soroban_sdk::{Address, Env, Map, Vec};

/// Resolve the effective weight for every address in `recipients`.
///
/// An address present in `weights` uses that weight. An address absent from
/// `weights` — including every address, when `weights` is empty — defaults
/// to weight `1`. That default is what makes "no weights provided" the same
/// as equal distribution: every recipient resolves to the same weight, so
/// [`compute_weighted_allocations`] splits `total_supply` evenly across them.
pub fn resolve_weights(
    env: &Env,
    recipients: &Vec<Address>,
    weights: &Map<Address, u32>,
) -> Map<Address, u32> {
    let mut resolved: Map<Address, u32> = Map::new(env);

    let mut i = 0u32;
    while i < recipients.len() {
        let recipient = recipients.get(i).unwrap();
        let weight = weights.get(recipient.clone()).unwrap_or(1);
        resolved.set(recipient, weight);
        i += 1;
    }

    resolved
}

/// Compute each address's allocation of `total_supply`, proportional to its
/// weight in `weights`.
///
/// Returns an empty map if `total_supply <= 0`, `weights` is empty, or every
/// weight in it is `0` — there is nothing to distribute, or no one eligible
/// to receive it, and returning nothing is the graceful outcome rather than
/// a division-by-zero panic.
///
/// Otherwise every returned allocation sums to exactly `total_supply`: each
/// address first gets `floor(total_supply * weight / total_weight)`, then
/// the leftover units (lost to flooring) are awarded one at a time, largest
/// remainder first, to make up the difference.
pub fn compute_weighted_allocations(
    env: &Env,
    total_supply: i128,
    weights: &Map<Address, u32>,
) -> Map<Address, i128> {
    let mut allocations: Map<Address, i128> = Map::new(env);

    if total_supply <= 0 || weights.is_empty() {
        return allocations;
    }

    let mut total_weight: u64 = 0;
    for (_, weight) in weights.iter() {
        total_weight = total_weight.saturating_add(weight as u64);
    }

    if total_weight == 0 {
        return allocations;
    }

    // Parallel list of (address, remainder), in the same iteration order as
    // `weights`, so the largest-remainder pass below can mutate remainders
    // without touching `allocations`' own iteration order.
    let mut remainders: Vec<(Address, i128)> = Vec::new(env);
    let mut distributed: i128 = 0;
    let total_weight_i = total_weight as i128;

    for (address, weight) in weights.iter() {
        let numerator = total_supply.saturating_mul(weight as i128);
        let base = numerator / total_weight_i;
        let remainder = numerator % total_weight_i;

        allocations.set(address.clone(), base);
        distributed = distributed.saturating_add(base);
        remainders.push_back((address, remainder));
    }

    let mut leftover = total_supply.saturating_sub(distributed);

    while leftover > 0 {
        let mut best_index: Option<u32> = None;
        let mut best_remainder: i128 = -1;

        let mut i = 0u32;
        while i < remainders.len() {
            let (_, remainder) = remainders.get(i).unwrap();
            if remainder > best_remainder {
                best_remainder = remainder;
                best_index = Some(i);
            }
            i += 1;
        }

        let index = match best_index {
            Some(i) => i,
            None => break,
        };

        let (address, _) = remainders.get(index).unwrap();
        let current = allocations.get(address.clone()).unwrap_or(0);
        allocations.set(address.clone(), current + 1);
        // Consumed: never picked again by this loop.
        remainders.set(index, (address, -1));
        leftover -= 1;
    }

    allocations
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn weight_two_receives_twice_weight_one() {
        let env = Env::default();
        let a = Address::generate(&env);
        let b = Address::generate(&env);

        let mut weights = Map::new(&env);
        weights.set(a.clone(), 1u32);
        weights.set(b.clone(), 2u32);

        let allocations = compute_weighted_allocations(&env, 300, &weights);

        assert_eq!(allocations.get(a.clone()).unwrap(), 100);
        assert_eq!(allocations.get(b.clone()).unwrap(), 200);
    }

    #[test]
    fn allocations_always_sum_to_the_total_supply() {
        let env = Env::default();
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        let c = Address::generate(&env);

        let mut weights = Map::new(&env);
        weights.set(a.clone(), 1u32);
        weights.set(b.clone(), 1u32);
        weights.set(c.clone(), 1u32);

        // 100 does not divide evenly by 3; the largest-remainder pass must
        // make up the missing unit.
        let allocations = compute_weighted_allocations(&env, 100, &weights);

        let sum = allocations.get(a).unwrap() + allocations.get(b).unwrap() + allocations.get(c).unwrap();
        assert_eq!(sum, 100);
    }

    #[test]
    fn no_weights_resolves_to_equal_distribution() {
        let env = Env::default();
        let a = Address::generate(&env);
        let b = Address::generate(&env);

        let mut recipients = Vec::new(&env);
        recipients.push_back(a.clone());
        recipients.push_back(b.clone());

        let empty_weights: Map<Address, u32> = Map::new(&env);
        let resolved = resolve_weights(&env, &recipients, &empty_weights);

        let allocations = compute_weighted_allocations(&env, 200, &resolved);

        assert_eq!(allocations.get(a).unwrap(), 100);
        assert_eq!(allocations.get(b).unwrap(), 100);
    }

    #[test]
    fn an_empty_weight_map_falls_back_gracefully_with_no_recipients() {
        let env = Env::default();
        let empty_weights: Map<Address, u32> = Map::new(&env);

        let allocations = compute_weighted_allocations(&env, 1_000, &empty_weights);

        assert!(allocations.is_empty());
    }

    #[test]
    fn zero_total_supply_yields_no_allocations() {
        let env = Env::default();
        let a = Address::generate(&env);
        let mut weights = Map::new(&env);
        weights.set(a, 5u32);

        let allocations = compute_weighted_allocations(&env, 0, &weights);

        assert!(allocations.is_empty());
    }

    #[test]
    fn a_recipient_missing_from_the_weight_map_defaults_to_weight_one() {
        let env = Env::default();
        let a = Address::generate(&env);
        let b = Address::generate(&env);

        let mut recipients = Vec::new(&env);
        recipients.push_back(a.clone());
        recipients.push_back(b.clone());

        // Only `a` has an explicit weight; `b` is missing entirely.
        let mut weights = Map::new(&env);
        weights.set(a.clone(), 3u32);

        let resolved = resolve_weights(&env, &recipients, &weights);
        assert_eq!(resolved.get(b.clone()).unwrap(), 1);

        let allocations = compute_weighted_allocations(&env, 400, &resolved);
        // a:b weight ratio is 3:1 -> 300:100.
        assert_eq!(allocations.get(a).unwrap(), 300);
        assert_eq!(allocations.get(b).unwrap(), 100);
    }
}
