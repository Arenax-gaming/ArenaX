# Contract invariants

Formal specifications and the properties they establish (Issue #879).

Each spec models one contract's value-moving core in TLA+ and is checked
exhaustively by TLC over a small bounded state space. Run them with:

```bash
cd contracts/specs && ./verify.sh          # all specs
cd contracts/specs && ./verify.sh AxToken  # one spec
```

## What a spec buys that tests do not

A test demonstrates that one sequence of calls behaves. A model checker
explores **every interleaving** up to a bound. That difference matters here
because the bugs these contracts are exposed to are not single-call bugs — they
are orderings nobody wrote a test for.

`TotalSupplyIsSumOfBalances` is the clearest example. No unit test can establish
it, because it is a claim about *every reachable state* rather than about one.
TLC either proves it holds within the bound or hands back the exact sequence of
calls that breaks it.

The bounds are deliberately small (3 accounts, supply of 6, reserves of 8).
Exhaustive checking is exponential, and these properties fail at two or three
actors if they fail at all; a larger model costs hours and finds nothing new.

## Invariants by contract

### `AxToken.tla` — AX token

| Invariant | Statement | Why it matters |
|---|---|---|
| `TotalSupplyIsSumOfBalances` | `totalSupply = Σ balances` | The single most important property. Every "mint value from nothing" exploit is a violation of this. |
| `NoNegativeBalances` | `∀a: balance[a] ≥ 0` | Trivial in TLA+'s `Nat`, **not** automatic in the Rust `i128` implementation — an unchecked subtraction is exactly this bug. |
| `SupplyWithinCap` | `totalSupply ≤ MaxSupply` | A mint path that exceeds the cap devalues every existing holder. |
| `VestingNeverOverClaims` | `∀a: claimed[a] ≤ granted[a]` | Without it, vesting is an unbounded mint. |

Temporal: `SupplyChangesOnlyViaMintOrBurn` — supply must never move as a side
effect of a transfer. Written as an action property so it also constrains
functions added later.

Modelled explicitly: **self-transfer is a no-op**. An implementation that reads
both balances before writing either will double a self-transfer, which is a real
and frequently-shipped bug.

### `StakingManager.tla` — staking manager

| Invariant | Statement | Why it matters |
|---|---|---|
| `PoolCoversAccruedRewards` | `Σ accrued ≤ rewardPool` | **The reason this spec exists.** If accrual can outrun funding the contract is insolvent, and it surfaces as one unlucky claimant's transaction reverting — the "last claimant gets nothing" bug. |
| `TotalStakedIsConsistent` | `totalStaked = Σ staked` | Every reward calculation divides by this cached total, so drift mis-prices every payout. |
| `NoNegativeStake` | `∀s: staked[s] ≥ 0` | Principal must never be spent paying rewards. |

Temporal: `AlwaysSolvent` (solvency holds at *every* step, not just at the end —
a transiently insolvent contract is insolvent for whoever's transaction lands in
that window), and `PrincipalOnlyReducedByUnstake`.

The guard `Σ accrued + amount ≤ rewardPool` in the `Accrue` action is the
modelled form of the solvency check. An implementation that accrues first and
discovers the shortfall at claim time violates it — which is precisely what the
spec is built to catch.

### `VirtualEconomy.tla` — liquidity pool

| Invariant | Statement | Why it matters |
|---|---|---|
| `ConstantProductNeverShrinks` | `x·y ≥ k` | The central AMM property. Any path that shrinks `k` drains the pool. Checked at runtime too — see the `k_after < k_before` guard in `AmmManager::swap`. |
| `SharesMatchLiquidity` | shares ⟺ reserves | Shares without reserves are claims on nothing; reserves without shares are unowned. |
| `MinimumLiquidityLocked` | `shares > 0 ⇒ shares ≥ MIN` | Closes the first-depositor share-inflation attack: if supply could return to dust, a donation could make a later depositor's share round to zero. |
| `NoOneSidedPool` | never exactly one empty reserve | The curve is asymptotic, so draining a reserve costs unbounded input and the state should be unreachable. |

`MaxReserve` is kept tiny on purpose: the invariant is most fragile at small
reserves, where integer truncation is proportionally largest — which is exactly
where a rounding-direction error shows up.

## Correspondence to the implementation

The specs describe the same guards the Rust enforces, so they can be read
together:

| Spec conjunct | Implementation |
|---|---|
| `(reserveA + in) * (reserveB - out) >= K` | the `k_after < k_before` check in `AmmManager::swap` |
| `shares * reserveA =< a * totalShares` | rounding **down** in `add_liquidity` |
| `a * totalShares =< shares * reserveA` | rounding **down** in `remove_liquidity` |
| `totalShares - shares >= MinLiquidity` | the locked `MINIMUM_LIQUIDITY` |
| `balance[from] >= amount` | the balance guard before every debit |
| `Σ accrued + amount =< rewardPool` | the solvency check before accrual |

## Limits worth stating

- **Bounded, not proved.** TLC checks exhaustively *within* the configured
  bounds. That catches ordering and accounting bugs decisively; it is not a
  proof for arbitrary values. A machine-checked proof (TLAPS or Coq) would be,
  and would be the natural next step for the AMM specifically.
- **The spec is not the code.** These model the contracts as written today. A
  change to either that is not reflected in the other makes the spec worse than
  useless, because it looks like coverage. `verify.sh` in CI catches spec
  regressions, not divergence — that still needs review discipline.
- **Arithmetic is idealised.** TLA+ integers are unbounded; Rust's `i128` is
  not, and the specs do not model overflow. The implementation uses checked
  arithmetic on every multiply that could realistically overflow.
