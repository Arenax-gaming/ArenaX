//! Contract standards compliance checker (#1555)
//!
//! New contracts were previously deployed without any automated check that
//! they actually implement the project's on-chain standards (semantic
//! versioning, an upgrade hook, and the shared error-reporting convention).
//! This module defines the [`ContractStandard`] interface every compliant
//! contract is expected to expose, and [`check_compliance`], which probes a
//! deployed contract address for that interface and returns a pass/fail
//! report, emitting `compliance_check_passed` / `compliance_check_failed`.
//!
//! `check_compliance` is a plain function rather than a method on a
//! deployable `#[contract]` — this crate stays dependency-free and is
//! imported as a library by the contracts that need it (see `lib.rs`'s
//! module docs), exactly like the `impl_pausable!` family of helpers. Any
//! contract that wants an on-chain "verify my peers" endpoint calls
//! `contract_standards::checker::check_compliance(&env, target)` from one of
//! its own contract functions.

use soroban_sdk::{
    contractclient, contracterror, contractevent, contracttype, Address, Env, String, Vec,
};

use crate::ContractVersion;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CheckerError {
    /// No compliant contract could be reached at the given address: either
    /// nothing is deployed there, or the deployed contract implements none
    /// of the `ContractStandard` interface (the two are indistinguishable
    /// at the SDK level, since probing `version()` is how we detect both).
    ContractNotFound = 1,
}

// ---------------------------------------------------------------------------
// Required interface
// ---------------------------------------------------------------------------

/// The minimal cross-contract-callable interface a contract must expose to
/// be considered standards-compliant. `check_compliance` calls each of these
/// on the target contract and records whether the call succeeded.
#[contractclient(name = "ContractStandardClient")]
pub trait ContractStandard {
    /// Semantic version of the deployed contract logic.
    fn version(env: Env) -> ContractVersion;
    /// Whether the contract exposes a working upgrade hook (true) or is
    /// intentionally immutable (false) — either answer is "compliant" as
    /// long as the function itself is callable.
    fn upgrade_hook(env: Env) -> bool;
    /// Records/emits a standardized error `code`; confirms the contract
    /// participates in the shared error-reporting convention.
    fn emit_error(env: Env, code: u32);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/// Outcome of a single named check within a compliance report.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CheckResult {
    pub name: String,
    pub passed: bool,
}

/// Full compliance report produced by [`check_compliance`] for one address.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ComplianceReport {
    pub contract: Address,
    pub checks: Vec<CheckResult>,
    pub compliant: bool,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent(topics = ["ContractStandards", "COMPLIANCE_PASSED"])]
pub struct CompliancePassed {
    pub contract: Address,
}

#[contractevent(topics = ["ContractStandards", "COMPLIANCE_FAILED"])]
pub struct ComplianceFailed {
    pub contract: Address,
    pub failed_checks: u32,
}

fn emit_compliance_check_passed(env: &Env, contract: &Address) {
    CompliancePassed {
        contract: contract.clone(),
    }
    .publish(env);
}

fn emit_compliance_check_failed(env: &Env, contract: &Address, failed_checks: u32) {
    ComplianceFailed {
        contract: contract.clone(),
        failed_checks,
    }
    .publish(env);
}

// ---------------------------------------------------------------------------
// Checker
// ---------------------------------------------------------------------------

/// Probes `contract_address` for the [`ContractStandard`] interface and
/// returns a report listing each check with pass/fail status.
///
/// `version()` doubles as the existence probe. If it can't be invoked —
/// because nothing is deployed at `contract_address`, or because whatever
/// is deployed there implements none of the standard — this returns
/// [`CheckerError::ContractNotFound`] rather than a report, since there's no
/// meaningful contract to report compliance for. Once `version()` succeeds,
/// `upgrade_hook()` and `emit_error()` are checked independently and any
/// individual failure just fails that check (and overall compliance)
/// without aborting the whole report.
pub fn check_compliance(
    env: &Env,
    contract_address: Address,
) -> Result<ComplianceReport, CheckerError> {
    let client = ContractStandardClient::new(env, &contract_address);

    let version_ok = client.try_version().is_ok();
    if !version_ok {
        return Err(CheckerError::ContractNotFound);
    }

    let upgrade_hook_ok = client.try_upgrade_hook().is_ok();
    let emit_error_ok = client.try_emit_error(&0u32).is_ok();

    let mut checks: Vec<CheckResult> = Vec::new(env);
    checks.push_back(CheckResult {
        name: String::from_str(env, "version"),
        passed: version_ok,
    });
    checks.push_back(CheckResult {
        name: String::from_str(env, "upgrade_hook"),
        passed: upgrade_hook_ok,
    });
    checks.push_back(CheckResult {
        name: String::from_str(env, "emit_error"),
        passed: emit_error_ok,
    });

    let failed_checks = checks.iter().filter(|c| !c.passed).count() as u32;
    let compliant = failed_checks == 0;

    if compliant {
        emit_compliance_check_passed(env, &contract_address);
    } else {
        emit_compliance_check_failed(env, &contract_address, failed_checks);
    }

    Ok(ComplianceReport {
        contract: contract_address,
        checks,
        compliant,
    })
}
