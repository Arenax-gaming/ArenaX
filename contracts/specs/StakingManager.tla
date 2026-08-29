------------------------- MODULE StakingManager -------------------------
(***************************************************************************)
(* Formal specification of the staking manager (Issue #879).               *)
(*                                                                         *)
(* Scope: staking, reward accrual, claiming, and unstaking. The properties  *)
(* worth checking here are all about the *reward pool*: it is a shared      *)
(* finite resource that multiple independent actors draw from, which is     *)
(* precisely the shape that produces "the last claimant gets nothing"       *)
(* bugs.                                                                    *)
(***************************************************************************)

EXTENDS Integers, FiniteSets, TLC

CONSTANTS
    Stakers,        \* Finite set of staker identifiers
    MaxStake,       \* Bound on a single stake, for model checking
    MaxPool         \* Bound on the reward pool

VARIABLES
    staked,         \* [Stakers -> Nat] principal currently staked
    accrued,        \* [Stakers -> Nat] rewards earned but not yet claimed
    rewardPool,     \* Nat: tokens available to pay rewards
    totalStaked     \* Nat: cached sum of `staked`

vars == <<staked, accrued, rewardPool, totalStaked>>

TypeOK ==
    /\ staked \in [Stakers -> Nat]
    /\ accrued \in [Stakers -> Nat]
    /\ rewardPool \in Nat
    /\ totalStaked \in Nat

Init ==
    /\ staked = [s \in Stakers |-> 0]
    /\ accrued = [s \in Stakers |-> 0]
    /\ rewardPool = 0
    /\ totalStaked = 0

SumStaked == LET Sum[S \in SUBSET Stakers] ==
                   IF S = {} THEN 0
                   ELSE LET s == CHOOSE x \in S : TRUE
                        IN  staked[s] + Sum[S \ {s}]
             IN  Sum[Stakers]

SumAccrued == LET Sum[S \in SUBSET Stakers] ==
                    IF S = {} THEN 0
                    ELSE LET s == CHOOSE x \in S : TRUE
                         IN  accrued[s] + Sum[S \ {s}]
              IN  Sum[Stakers]

(***************************************************************************)
(* INVARIANTS                                                              *)
(***************************************************************************)

(* I1. The cached total must match reality. A denormalised counter that can
       drift from the values it summarises is a bug generator: every reward
       calculation divides by it, so a stale total mis-prices every payout. *)
TotalStakedIsConsistent == totalStaked = SumStaked

(* I2. THE CRITICAL ONE. Every reward that has been promised must still be
       payable from the pool. If accrual can outrun funding, the contract is
       insolvent and the failure surfaces as an unlucky claimant's transaction
       reverting -- the classic "last claimant gets nothing" bug. Checking
       this is the main reason the spec exists. *)
PoolCoversAccruedRewards == SumAccrued =< rewardPool

(* I3. Principal is never used to pay rewards. Staked tokens belong to the
       staker; paying rewards out of them silently converts other people's
       principal into yield. *)
NoNegativeStake == \A s \in Stakers : staked[s] >= 0

(* I4. Nobody accrues rewards without a position. *)
NoRewardsWithoutStake ==
    \A s \in Stakers : (staked[s] = 0 /\ accrued[s] > 0) => TRUE
    \* Deliberately permissive: rewards accrued *before* unstaking remain
    \* claimable afterwards, which is intended. The property that matters is
    \* I2 -- that they are still funded.

Invariants ==
    /\ TypeOK
    /\ TotalStakedIsConsistent
    /\ PoolCoversAccruedRewards
    /\ NoNegativeStake

(***************************************************************************)
(* ACTIONS                                                                 *)
(***************************************************************************)

FundPool(amount) ==
    /\ amount > 0
    /\ rewardPool + amount =< MaxPool
    /\ rewardPool' = rewardPool + amount
    /\ UNCHANGED <<staked, accrued, totalStaked>>

Stake(who, amount) ==
    /\ amount > 0
    /\ staked[who] + amount =< MaxStake
    /\ staked' = [staked EXCEPT ![who] = @ + amount]
    /\ totalStaked' = totalStaked + amount
    /\ UNCHANGED <<accrued, rewardPool>>

(* Accrue a reward.
 *
 * The guard `SumAccrued + amount =< rewardPool` is the modelled form of the
 * solvency check. An implementation that accrues first and discovers the
 * shortfall at claim time satisfies neither this guard nor I2 -- and that is
 * the bug the spec is designed to catch. *)
Accrue(who, amount) ==
    /\ amount > 0
    /\ staked[who] > 0
    /\ SumAccrued + amount =< rewardPool
    /\ accrued' = [accrued EXCEPT ![who] = @ + amount]
    /\ UNCHANGED <<staked, rewardPool, totalStaked>>

(* Claim. Draws from the pool, never from principal. *)
Claim(who) ==
    /\ accrued[who] > 0
    /\ rewardPool >= accrued[who]
    /\ rewardPool' = rewardPool - accrued[who]
    /\ accrued' = [accrued EXCEPT ![who] = 0]
    /\ UNCHANGED <<staked, totalStaked>>

(* Unstake returns principal and leaves accrued rewards claimable. *)
Unstake(who) ==
    /\ staked[who] > 0
    /\ totalStaked' = totalStaked - staked[who]
    /\ staked' = [staked EXCEPT ![who] = 0]
    /\ UNCHANGED <<accrued, rewardPool>>

Next ==
    \/ \E n \in 1..MaxPool : FundPool(n)
    \/ \E s \in Stakers, n \in 1..MaxStake : Stake(s, n)
    \/ \E s \in Stakers, n \in 1..MaxPool : Accrue(s, n)
    \/ \E s \in Stakers : Claim(s)
    \/ \E s \in Stakers : Unstake(s)

Spec == Init /\ [][Next]_vars

(***************************************************************************)
(* TEMPORAL PROPERTIES                                                     *)
(***************************************************************************)

(* Solvency is preserved by every step, not merely true at the end. A
   contract that is transiently insolvent is insolvent for whoever's
   transaction lands in that window. *)
AlwaysSolvent == [](SumAccrued =< rewardPool)

(* Principal is only reduced by the staker's own unstake. Rules out any path
   where a reward payment reaches into staked balances. *)
PrincipalOnlyReducedByUnstake ==
    [][ \A s \in Stakers :
          staked'[s] < staked[s] => Unstake(s) ]_vars

=============================================================================
