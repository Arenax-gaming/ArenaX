------------------------ MODULE VirtualEconomy ------------------------
(***************************************************************************)
(* Formal specification of the virtual economy AMM (Issues #879, #882).    *)
(*                                                                         *)
(* Scope: the constant-product liquidity pool. The rest of the virtual     *)
(* economy (NFTs, marketplace, royalties) is out of scope here -- the pool *)
(* is where an ordering bug costs money rather than correctness.           *)
(*                                                                         *)
(* WHY THE POOL SPECIFICALLY                                               *)
(*                                                                         *)
(* An AMM is an adversarial setting by construction: anyone may call any   *)
(* operation in any order, and a profitable ordering is an attack. The     *)
(* properties below are the ones that, if violated, let someone extract    *)
(* value from LPs -- and each corresponds to a rounding decision in        *)
(* virtual-economy/src/amm.rs.                                            *)
(***************************************************************************)

EXTENDS Integers, TLC

CONSTANTS
    MaxReserve,     \* Bound on either reserve, for model checking
    FeeBps,         \* Swap fee in basis points (30 = 0.3%)
    MinLiquidity    \* Permanently locked LP tokens

VARIABLES
    reserveA,       \* Nat
    reserveB,       \* Nat
    totalShares,    \* Nat: LP tokens outstanding, including MinLiquidity
    kFloor          \* Nat: the lowest value of reserveA*reserveB seen so far

vars == <<reserveA, reserveB, totalShares, kFloor>>

BPS == 10000

TypeOK ==
    /\ reserveA \in Nat
    /\ reserveB \in Nat
    /\ totalShares \in Nat
    /\ kFloor \in Nat

Init ==
    /\ reserveA = 0
    /\ reserveB = 0
    /\ totalShares = 0
    /\ kFloor = 0

K == reserveA * reserveB

(***************************************************************************)
(* INVARIANTS                                                              *)
(***************************************************************************)

(* I1. THE CENTRAL ONE. The product never decreases through a swap. Every
       path that can shrink k is a path that drains the pool, and the fee is
       precisely what makes it grow. The Rust implementation checks this at
       runtime rather than assuming it -- see the k_after < k_before guard in
       AmmManager::swap. *)
ConstantProductNeverShrinks == K >= kFloor

(* I2. Shares exist if and only if liquidity does. A pool with shares but no
       reserves has issued claims on nothing; reserves with no shares are
       unowned. *)
SharesMatchLiquidity ==
    /\ (totalShares > 0) => (reserveA > 0 /\ reserveB > 0)
    /\ (reserveA > 0 /\ reserveB > 0) => (totalShares > 0)

(* I3. The locked minimum is never redeemable. This is what prevents the
       first-depositor share-inflation attack: if total supply could return
       to zero (or to dust), an attacker could donate directly to the pool and
       make a later depositor's share round to nothing. *)
MinimumLiquidityLocked == (totalShares > 0) => (totalShares >= MinLiquidity)

(* I4. Reserves are never fully drained by trading. The curve is asymptotic:
       taking the last unit of a reserve costs unbounded input, so any state
       with one reserve at zero and the other positive is unreachable through
       swaps. *)
NoOneSidedPool == ~(reserveA = 0 /\ reserveB > 0) /\ ~(reserveB = 0 /\ reserveA > 0)

Invariants ==
    /\ TypeOK
    /\ ConstantProductNeverShrinks
    /\ SharesMatchLiquidity
    /\ MinimumLiquidityLocked
    /\ NoOneSidedPool

(***************************************************************************)
(* ACTIONS                                                                 *)
(***************************************************************************)

(* First deposit. Mints sqrt(a*b) minus the locked minimum; modelled with a
   nondeterministic `shares` bounded by both amounts, since TLA+ has no
   integer sqrt and the exact figure does not affect the properties. *)
InitialDeposit(a, b, shares) ==
    /\ totalShares = 0
    /\ a > 0 /\ b > 0
    /\ shares > 0
    /\ shares =< a /\ shares =< b        \* cannot mint more than either side funds
    /\ shares + MinLiquidity =< a * b
    /\ reserveA' = a
    /\ reserveB' = b
    /\ totalShares' = shares + MinLiquidity
    /\ kFloor' = a * b

(* Subsequent deposit. Must not move the price: shares are proportional, and
   an off-ratio deposit forfeits the excess rather than repricing the pool --
   otherwise depositing would be a fee-free way to trade. *)
Deposit(a, b, shares) ==
    /\ totalShares > 0
    /\ a > 0 /\ b > 0
    /\ reserveA + a =< MaxReserve
    /\ reserveB + b =< MaxReserve
    /\ shares > 0
    \* Proportional, rounded down: shares =< min(a*S/rA, b*S/rB)
    /\ shares * reserveA =< a * totalShares
    /\ shares * reserveB =< b * totalShares
    /\ reserveA' = reserveA + a
    /\ reserveB' = reserveB + b
    /\ totalShares' = totalShares + shares
    /\ kFloor' = kFloor          \* k grows; the floor does not move

(* Withdrawal. Proportional and rounded down, so the pool never pays out more
   than the share is worth. The locked minimum can never be burned. *)
Withdraw(shares, a, b) ==
    /\ shares > 0
    /\ totalShares - shares >= MinLiquidity
    /\ a > 0 /\ b > 0
    /\ a * totalShares =< shares * reserveA      \* rounds down
    /\ b * totalShares =< shares * reserveB
    /\ reserveA - a > 0
    /\ reserveB - b > 0
    /\ reserveA' = reserveA - a
    /\ reserveB' = reserveB - b
    /\ totalShares' = totalShares - shares
    \* A withdrawal legitimately lowers k, so the floor follows it down --
    \* otherwise every withdrawal would look like an invariant violation.
    /\ kFloor' = (reserveA - a) * (reserveB - b)

(* Swap A for B.
 *
 * `amountOut` is bounded by the post-fee curve and rounds down. The
 * conjunct `(reserveA + amountIn) * (reserveB - amountOut) >= K` is the
 * modelled form of the runtime check in AmmManager::swap: it is what makes
 * I1 hold, and removing it makes the model checker produce a draining trace
 * immediately. *)
SwapAForB(amountIn, amountOut) ==
    /\ reserveA > 0 /\ reserveB > 0
    /\ amountIn > 0
    /\ reserveA + amountIn =< MaxReserve
    /\ amountOut > 0
    /\ amountOut < reserveB                       \* cannot drain the reserve
    /\ (reserveA + amountIn) * (reserveB - amountOut) >= K
    /\ reserveA' = reserveA + amountIn
    /\ reserveB' = reserveB - amountOut
    /\ UNCHANGED totalShares
    /\ kFloor' = kFloor

SwapBForA(amountIn, amountOut) ==
    /\ reserveA > 0 /\ reserveB > 0
    /\ amountIn > 0
    /\ reserveB + amountIn =< MaxReserve
    /\ amountOut > 0
    /\ amountOut < reserveA
    /\ (reserveB + amountIn) * (reserveA - amountOut) >= K
    /\ reserveB' = reserveB + amountIn
    /\ reserveA' = reserveA - amountOut
    /\ UNCHANGED totalShares
    /\ kFloor' = kFloor

Next ==
    \/ \E a, b, s \in 1..MaxReserve : InitialDeposit(a, b, s)
    \/ \E a, b, s \in 1..MaxReserve : Deposit(a, b, s)
    \/ \E s, a, b \in 1..MaxReserve : Withdraw(s, a, b)
    \/ \E i, o \in 1..MaxReserve : SwapAForB(i, o)
    \/ \E i, o \in 1..MaxReserve : SwapBForA(i, o)

Spec == Init /\ [][Next]_vars

(***************************************************************************)
(* TEMPORAL PROPERTIES                                                     *)
(***************************************************************************)

(* A swap must never reduce k. Stated as an action property so it constrains
   every future swap variant, not just the two defined here. *)
SwapsPreserveK ==
    [][ (UNCHANGED totalShares /\ (reserveA' # reserveA \/ reserveB' # reserveB))
          => (reserveA' * reserveB' >= reserveA * reserveB) ]_vars

(* Once liquidity exists, the locked minimum keeps total supply off zero
   forever -- the property that closes the share-inflation attack. *)
LiquidityFloorHolds == [](totalShares > 0 => totalShares >= MinLiquidity)

=============================================================================
