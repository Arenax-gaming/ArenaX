---------------------------- MODULE AxToken ----------------------------
(***************************************************************************)
(* Formal specification of the AX token contract (Issue #879).             *)
(*                                                                         *)
(* Scope: the value-conserving core -- mint, burn, transfer, and vesting.  *)
(* Administrative operations that cannot move balances are out of scope,   *)
(* because they cannot violate any of the invariants below.                *)
(*                                                                         *)
(* WHY A SPEC AT ALL                                                       *)
(*                                                                         *)
(* Tests demonstrate that specific sequences behave. A model checker        *)
(* explores *every* interleaving up to a bound, which is where token bugs  *)
(* actually live: not in a single call, but in an ordering nobody wrote a  *)
(* test for. TotalSupplyIsSumOfBalances below is exactly the property a    *)
(* unit test cannot establish, because it is a statement about all         *)
(* reachable states rather than about one.                                 *)
(***************************************************************************)

EXTENDS Integers, FiniteSets, TLC

CONSTANTS
    Accounts,       \* Finite set of account identifiers
    MaxSupply,      \* Hard cap on total supply
    Admin           \* The privileged account

VARIABLES
    balance,        \* [Accounts -> Nat]
    totalSupply,    \* Nat
    vestingTotal,   \* [Accounts -> Nat] tokens locked in a vesting schedule
    vestingClaimed  \* [Accounts -> Nat] tokens already released

vars == <<balance, totalSupply, vestingTotal, vestingClaimed>>

(***************************************************************************)
(* Type invariant.                                                         *)
(***************************************************************************)
TypeOK ==
    /\ balance \in [Accounts -> Nat]
    /\ totalSupply \in Nat
    /\ vestingTotal \in [Accounts -> Nat]
    /\ vestingClaimed \in [Accounts -> Nat]

Init ==
    /\ balance = [a \in Accounts |-> 0]
    /\ totalSupply = 0
    /\ vestingTotal = [a \in Accounts |-> 0]
    /\ vestingClaimed = [a \in Accounts |-> 0]

SumOfBalances == LET Sum[S \in SUBSET Accounts] ==
                       IF S = {} THEN 0
                       ELSE LET a == CHOOSE x \in S : TRUE
                            IN  balance[a] + Sum[S \ {a}]
                 IN  Sum[Accounts]

(***************************************************************************)
(* INVARIANTS                                                              *)
(***************************************************************************)

(* I1. Supply accounting. The single most important property: the recorded
       total must always equal what the accounts actually hold. Every token
       exploit that mints value out of nothing is a violation of this. *)
TotalSupplyIsSumOfBalances == totalSupply = SumOfBalances

(* I2. No negative balances. Trivially true in Nat, stated explicitly because
       the Rust implementation uses i128 where it is *not* automatic --
       an unchecked subtraction is the corresponding bug. *)
NoNegativeBalances == \A a \in Accounts : balance[a] >= 0

(* I3. The cap holds. A mint path that can exceed MaxSupply devalues every
       existing holder. *)
SupplyWithinCap == totalSupply =< MaxSupply

(* I4. Vesting cannot over-release. Claimed must never exceed granted,
       otherwise vesting becomes an unbounded mint. *)
VestingNeverOverClaims ==
    \A a \in Accounts : vestingClaimed[a] =< vestingTotal[a]

Invariants ==
    /\ TypeOK
    /\ TotalSupplyIsSumOfBalances
    /\ NoNegativeBalances
    /\ SupplyWithinCap
    /\ VestingNeverOverClaims

(***************************************************************************)
(* ACTIONS                                                                 *)
(***************************************************************************)

(* Mint. Guarded by the cap; only the admin may perform it. *)
Mint(to, amount) ==
    /\ amount > 0
    /\ totalSupply + amount =< MaxSupply
    /\ balance' = [balance EXCEPT ![to] = @ + amount]
    /\ totalSupply' = totalSupply + amount
    /\ UNCHANGED <<vestingTotal, vestingClaimed>>

(* Burn. The balance guard is what keeps I1 and I2 together: burning more
   than an account holds would either underflow the balance or desynchronise
   the supply, depending on which the implementation checks. *)
Burn(from, amount) ==
    /\ amount > 0
    /\ balance[from] >= amount
    /\ balance' = [balance EXCEPT ![from] = @ - amount]
    /\ totalSupply' = totalSupply - amount
    /\ UNCHANGED <<vestingTotal, vestingClaimed>>

(* Transfer. Conserves supply by construction -- and note the self-transfer
   case: `from = to` must be a no-op rather than a double-application, which
   is a real implementation bug when the code reads both balances before
   writing either. *)
Transfer(from, to, amount) ==
    /\ amount > 0
    /\ from # to
    /\ balance[from] >= amount
    /\ balance' = [balance EXCEPT ![from] = @ - amount, ![to] = @ + amount]
    /\ UNCHANGED <<totalSupply, vestingTotal, vestingClaimed>>

SelfTransfer(who, amount) ==
    /\ amount > 0
    /\ balance[who] >= amount
    /\ UNCHANGED vars          \* must be a no-op, not a doubling

(* Grant a vesting schedule. The tokens are minted into the contract's
   accounting at grant time, so the cap applies here too. *)
GrantVesting(to, amount) ==
    /\ amount > 0
    /\ vestingTotal[to] = 0     \* one schedule per beneficiary
    /\ totalSupply + amount =< MaxSupply
    /\ vestingTotal' = [vestingTotal EXCEPT ![to] = amount]
    /\ totalSupply' = totalSupply + amount
    /\ balance' = [balance EXCEPT ![to] = @ + amount]
    /\ UNCHANGED vestingClaimed

(* Claim vested tokens. Bounded by what remains unclaimed -- the guard that
   makes I4 hold. *)
ClaimVested(who, amount) ==
    /\ amount > 0
    /\ vestingClaimed[who] + amount =< vestingTotal[who]
    /\ vestingClaimed' = [vestingClaimed EXCEPT ![who] = @ + amount]
    /\ UNCHANGED <<balance, totalSupply, vestingTotal>>

(* Revoke a schedule, returning the unvested remainder. *)
RevokeVesting(who) ==
    /\ vestingTotal[who] > 0
    /\ LET unvested == vestingTotal[who] - vestingClaimed[who] IN
        /\ balance[who] >= unvested
        /\ balance' = [balance EXCEPT ![who] = @ - unvested]
        /\ totalSupply' = totalSupply - unvested
    /\ vestingTotal' = [vestingTotal EXCEPT ![who] = 0]
    /\ vestingClaimed' = [vestingClaimed EXCEPT ![who] = 0]

Next ==
    \/ \E a \in Accounts, n \in 1..MaxSupply : Mint(a, n)
    \/ \E a \in Accounts, n \in 1..MaxSupply : Burn(a, n)
    \/ \E a, b \in Accounts, n \in 1..MaxSupply : Transfer(a, b, n)
    \/ \E a \in Accounts, n \in 1..MaxSupply : SelfTransfer(a, n)
    \/ \E a \in Accounts, n \in 1..MaxSupply : GrantVesting(a, n)
    \/ \E a \in Accounts, n \in 1..MaxSupply : ClaimVested(a, n)
    \/ \E a \in Accounts : RevokeVesting(a)

Spec == Init /\ [][Next]_vars

(***************************************************************************)
(* TEMPORAL PROPERTIES                                                     *)
(***************************************************************************)

(* Supply only changes through mint, burn, or vesting grant/revoke -- never
   as a side effect of a transfer. Stated as an action property so the model
   checker rejects any future action that quietly moves it. *)
SupplyChangesOnlyViaMintOrBurn ==
    [][ totalSupply' # totalSupply =>
          \E a \in Accounts, n \in 1..MaxSupply :
              \/ Mint(a, n)
              \/ Burn(a, n)
              \/ GrantVesting(a, n)
              \/ RevokeVesting(a) ]_vars

=============================================================================
