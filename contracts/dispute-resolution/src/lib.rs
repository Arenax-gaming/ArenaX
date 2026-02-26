#![no_std]

use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, Address, BytesN, Env, IntoVal, String, Symbol,
};

#[contractevent(topics = ["ArenaXDispute", "OPENED"])]
pub struct DisputeOpened {
    pub match_id: BytesN<32>,
    pub reason: String,
    pub evidence_ref: String,
    pub deadline: u64,
}

#[contractevent(topics = ["ArenaXDispute", "RESOLVED"])]
pub struct DisputeResolved {
    pub match_id: BytesN<32>,
    pub decision: String,
    pub resolved_at: u64,
    pub operator: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DisputeStatus {
    Open = 0,
    Resolved = 1,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DisputeData {
    pub match_id: BytesN<32>,
    pub reason: String,
    pub evidence_ref: String,
    pub status: u32,
    pub opened_at: u64,
    pub deadline: u64,
    pub decision: Option<String>,
    pub resolved_at: Option<u64>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    IdentityContract,
    ResolutionWindow,
    Dispute(BytesN<32>),
}

#[contract]
pub struct DisputeResolutionContract;

#[contractimpl]
impl DisputeResolutionContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        identity_contract: Address,
        resolution_window: u64,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::IdentityContract, &identity_contract);
        env.storage()
            .instance()
            .set(&DataKey::ResolutionWindow, &resolution_window);
    }

    pub fn open_dispute(env: Env, match_id: BytesN<32>, reason: String, evidence_ref: String) {
        if env
            .storage()
            .persistent()
            .has(&DataKey::Dispute(match_id.clone()))
        {
            panic!("dispute already opened");
        }

        let resolution_window: u64 = env
            .storage()
            .instance()
            .get(&DataKey::ResolutionWindow)
            .expect("contract not initialized");

        let opened_at = env.ledger().timestamp();
        let deadline = opened_at + resolution_window;

        let dispute = DisputeData {
            match_id: match_id.clone(),
            reason: reason.clone(),
            evidence_ref: evidence_ref.clone(),
            status: DisputeStatus::Open as u32,
            opened_at,
            deadline,
            decision: None,
            resolved_at: None,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Dispute(match_id.clone()), &dispute);

        DisputeOpened {
            match_id,
            reason,
            evidence_ref,
            deadline,
        }
        .publish(&env);
    }

    pub fn resolve_dispute(env: Env, match_id: BytesN<32>, caller: Address, decision: String) {
        caller.require_auth();

        if !Self::is_operator(&env, &caller) {
            panic!("unauthorized call: only operators can adjudicate disputes");
        }

        let mut dispute: DisputeData = env
            .storage()
            .persistent()
            .get(&DataKey::Dispute(match_id.clone()))
            .expect("dispute not found");

        if dispute.status != DisputeStatus::Open as u32 {
            panic!("dispute is not open");
        }

        let current_time = env.ledger().timestamp();
        if current_time > dispute.deadline {
            panic!("resolution deadline has passed");
        }

        dispute.status = DisputeStatus::Resolved as u32;
        dispute.decision = Some(decision.clone());
        dispute.resolved_at = Some(current_time);

        env.storage()
            .persistent()
            .set(&DataKey::Dispute(match_id.clone()), &dispute);

        DisputeResolved {
            match_id,
            decision,
            resolved_at: current_time,
            operator: caller,
        }
        .publish(&env);
    }

    pub fn is_disputed(env: Env, match_id: BytesN<32>) -> bool {
        if let Some(dispute) = env
            .storage()
            .persistent()
            .get::<DataKey, DisputeData>(&DataKey::Dispute(match_id))
        {
            return dispute.status == DisputeStatus::Open as u32;
        }
        false
    }

    fn is_operator(env: &Env, addr: &Address) -> bool {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("contract not initialized");

        if addr == &admin {
            return true;
        }

        if let Some(identity_contract) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::IdentityContract)
        {
            let role: u32 = env.invoke_contract(
                &identity_contract,
                &Symbol::new(env, "get_role"),
                (addr.clone(),).into_val(env),
            );
            return role == 1 || role == 2;
        }

        false
    }
}
