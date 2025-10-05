use soroban_sdk::{Address, Env, String, Symbol};

pub struct Events;

impl Events {
    pub fn emit_initialized(env: &Env, admin: &Address, token_address: &Address) {
        env.events().publish(
            (Symbol::new(env, "initialized"),),
            (admin.clone(), token_address.clone()),
        );
    }

    pub fn emit_prize_pool_created(
        env: &Env,
        tournament_id: u64,
        entry_fee: i128,
        max_participants: u32,
    ) {
        env.events().publish(
            (Symbol::new(env, "prize_pool_created"), tournament_id),
            (entry_fee, max_participants),
        );
    }

    pub fn emit_entry_fee_added(
        env: &Env,
        tournament_id: u64,
        participant: &Address,
        amount: i128,
    ) {
        env.events().publish(
            (Symbol::new(env, "entry_fee_added"), tournament_id),
            (participant.clone(), amount),
        );
    }

    pub fn emit_prizes_distributed(
        env: &Env,
        tournament_id: u64,
        total_distributed: i128,
    ) {
        env.events().publish(
            (Symbol::new(env, "prizes_distributed"), tournament_id),
            total_distributed,
        );
    }

    pub fn emit_refunds_processed(
        env: &Env,
        tournament_id: u64,
        total_refunded: i128,
        reason: &String,
    ) {
        env.events().publish(
            (Symbol::new(env, "refunds_processed"), tournament_id),
            (total_refunded, reason.clone()),
        );
    }

    pub fn emit_rules_updated(env: &Env, tournament_id: u64) {
        env.events().publish(
            (Symbol::new(env, "rules_updated"), tournament_id),
            (),
        );
    }

    pub fn emit_tournament_cancelled(env: &Env, tournament_id: u64) {
        env.events().publish(
            (Symbol::new(env, "tournament_cancelled"), tournament_id),
            (),
        );
    }

    pub fn emit_contract_paused(env: &Env) {
        env.events()
            .publish((Symbol::new(env, "contract_paused"),), ());
    }

    pub fn emit_contract_unpaused(env: &Env) {
        env.events()
            .publish((Symbol::new(env, "contract_unpaused"),), ());
    }
}
