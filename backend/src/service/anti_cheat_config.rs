//! Runtime-configurable anti-cheat scoring thresholds — Issue #1358.
//!
//! Each detection rule carries a weight (contribution to the composite score)
//! and a threshold (the per-rule trip value). The composite suspicion score is
//! the sum of weights for every rule whose metric crosses its threshold.
//! Thresholds are loaded from Redis or fall back to compiled-in defaults; a
//! background refresh applies new values within one cache TTL.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

/// One configurable detection rule.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RuleConfig {
    /// Name/identifier for this rule (e.g. "reaction_inhuman").
    pub name: String,
    /// Weight added to the composite score when this rule fires (0-100).
    pub weight: u8,
    /// The rule-level threshold below/above which the rule fires.
    /// Interpretation depends on the rule (e.g. reaction_ms below 50).
    pub threshold: u32,
    /// Whether this rule is active.
    pub enabled: bool,
}

/// Full anti-cheat scoring configuration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AntiCheatConfig {
    /// Score at or above which a finding is flagged (0-100).
    pub flag_threshold: u8,
    /// Individual rule configurations, keyed by rule name.
    pub rules: HashMap<String, RuleConfig>,
}

impl Default for AntiCheatConfig {
    fn default() -> Self {
        let mut rules = HashMap::new();

        rules.insert(
            "reaction_inhuman".to_string(),
            RuleConfig {
                name: "reaction_inhuman".to_string(),
                weight: 50,
                threshold: 50,
                enabled: true,
            },
        );
        rules.insert(
            "reaction_fast".to_string(),
            RuleConfig {
                name: "reaction_fast".to_string(),
                weight: 30,
                threshold: 90,
                enabled: true,
            },
        );
        rules.insert(
            "accuracy_extreme".to_string(),
            RuleConfig {
                name: "accuracy_extreme".to_string(),
                weight: 25,
                threshold: 9500,
                enabled: true,
            },
        );
        rules.insert(
            "accuracy_high".to_string(),
            RuleConfig {
                name: "accuracy_high".to_string(),
                weight: 15,
                threshold: 8500,
                enabled: true,
            },
        );
        rules.insert(
            "snap_extreme".to_string(),
            RuleConfig {
                name: "snap_extreme".to_string(),
                weight: 35,
                threshold: 1440,
                enabled: true,
            },
        );
        rules.insert(
            "snap_fast".to_string(),
            RuleConfig {
                name: "snap_fast".to_string(),
                weight: 20,
                threshold: 720,
                enabled: true,
            },
        );
        rules.insert(
            "speed_hack".to_string(),
            RuleConfig {
                name: "speed_hack".to_string(),
                weight: 40,
                threshold: 0,
                enabled: true,
            },
        );
        rules.insert(
            "input_scripted".to_string(),
            RuleConfig {
                name: "input_scripted".to_string(),
                weight: 15,
                threshold: 500,
                enabled: true,
            },
        );

        Self {
            flag_threshold: 70,
            rules,
        }
    }
}

/// Source of truth for the config. Redis in production; in-memory stub in tests.
pub trait ConfigProvider: Send + Sync {
    /// Returns the current config, or `None` to keep the existing cached value.
    fn load(&self) -> Option<AntiCheatConfig>;
}

/// Always returns the same pre-set config — used in tests.
pub struct StaticConfigProvider {
    config: AntiCheatConfig,
}

impl StaticConfigProvider {
    pub fn new(config: AntiCheatConfig) -> Self {
        Self { config }
    }
}

impl ConfigProvider for StaticConfigProvider {
    fn load(&self) -> Option<AntiCheatConfig> {
        Some(self.config.clone())
    }
}

/// Returns `AntiCheatConfig::default()` — used when Redis is unavailable.
pub struct DefaultConfigProvider;

impl ConfigProvider for DefaultConfigProvider {
    fn load(&self) -> Option<AntiCheatConfig> {
        Some(AntiCheatConfig::default())
    }
}

/// Thread-safe, TTL-cached config store. On cache miss or expiry, reloads from
/// the provider. Callers always get a snapshot — they never block on I/O.
pub struct AntiCheatConfigStore {
    cached: RwLock<(AntiCheatConfig, Instant)>,
    ttl: Duration,
    provider: Arc<dyn ConfigProvider>,
}

impl AntiCheatConfigStore {
    pub fn new(ttl: Duration, provider: Arc<dyn ConfigProvider>) -> Self {
        // Start with an already-expired timestamp so the first `get()` always
        // triggers a provider fetch.
        let expired_at = Instant::now()
            .checked_sub(ttl + Duration::from_secs(1))
            .unwrap_or_else(Instant::now);
        Self {
            cached: RwLock::new((AntiCheatConfig::default(), expired_at)),
            ttl,
            provider,
        }
    }

    /// Get the current config, refreshing from the provider if the TTL has expired.
    pub fn get(&self) -> AntiCheatConfig {
        {
            let guard = self.cached.read().expect("anti_cheat_config read lock");
            if guard.1.elapsed() < self.ttl {
                return guard.0.clone();
            }
        }
        // TTL expired — attempt a refresh under a write lock.
        self.refresh();
        self.cached
            .read()
            .expect("anti_cheat_config read lock after refresh")
            .0
            .clone()
    }

    /// Force a refresh regardless of TTL.
    pub fn refresh(&self) {
        if let Some(new_config) = self.provider.load() {
            let mut guard = self.cached.write().expect("anti_cheat_config write lock");
            guard.0 = new_config;
            guard.1 = Instant::now();
        }
    }

    /// Update the flag threshold directly (for testing / runtime override).
    pub fn set_flag_threshold(&self, threshold: u8) {
        let mut guard = self.cached.write().expect("anti_cheat_config write lock");
        guard.0.flag_threshold = threshold;
        guard.1 = Instant::now();
    }

    /// Update a rule's weight (for testing / runtime override).
    pub fn set_rule_weight(&self, rule_name: &str, weight: u8) {
        let mut guard = self.cached.write().expect("anti_cheat_config write lock");
        if let Some(rule) = guard.0.rules.get_mut(rule_name) {
            rule.weight = weight;
        }
        guard.1 = Instant::now();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_has_expected_flag_threshold() {
        let config = AntiCheatConfig::default();
        assert_eq!(config.flag_threshold, 70);
    }

    #[test]
    fn default_config_contains_all_eight_rules() {
        let config = AntiCheatConfig::default();
        let expected = [
            "reaction_inhuman",
            "reaction_fast",
            "accuracy_extreme",
            "accuracy_high",
            "snap_extreme",
            "snap_fast",
            "speed_hack",
            "input_scripted",
        ];
        for name in expected {
            assert!(config.rules.contains_key(name), "missing rule: {name}");
            assert!(config.rules[name].enabled, "rule {name} should be enabled");
        }
    }

    #[test]
    fn default_rule_weights_match_original_hardcoded_values() {
        let config = AntiCheatConfig::default();
        assert_eq!(config.rules["reaction_inhuman"].weight, 50);
        assert_eq!(config.rules["reaction_fast"].weight, 30);
        assert_eq!(config.rules["accuracy_extreme"].weight, 25);
        assert_eq!(config.rules["accuracy_high"].weight, 15);
        assert_eq!(config.rules["snap_extreme"].weight, 35);
        assert_eq!(config.rules["snap_fast"].weight, 20);
        assert_eq!(config.rules["speed_hack"].weight, 40);
        assert_eq!(config.rules["input_scripted"].weight, 15);
    }

    #[test]
    fn static_provider_returns_its_config() {
        let mut config = AntiCheatConfig::default();
        config.flag_threshold = 42;
        let provider = StaticConfigProvider::new(config.clone());
        assert_eq!(provider.load(), Some(config));
    }

    #[test]
    fn default_provider_returns_default_config() {
        let provider = DefaultConfigProvider;
        assert_eq!(provider.load(), Some(AntiCheatConfig::default()));
    }

    #[test]
    fn store_refreshes_on_first_get() {
        let mut config = AntiCheatConfig::default();
        config.flag_threshold = 55;
        let store = AntiCheatConfigStore::new(
            Duration::from_secs(60),
            Arc::new(StaticConfigProvider::new(config)),
        );
        // First get should trigger refresh and pick up flag_threshold=55.
        assert_eq!(store.get().flag_threshold, 55);
    }

    #[test]
    fn set_flag_threshold_overrides_immediately() {
        let store = AntiCheatConfigStore::new(
            Duration::from_secs(60),
            Arc::new(DefaultConfigProvider),
        );
        store.refresh();
        store.set_flag_threshold(10);
        assert_eq!(store.get().flag_threshold, 10);
    }

    #[test]
    fn set_rule_weight_overrides_immediately() {
        let store = AntiCheatConfigStore::new(
            Duration::from_secs(60),
            Arc::new(DefaultConfigProvider),
        );
        store.refresh();
        store.set_rule_weight("speed_hack", 99);
        assert_eq!(store.get().rules["speed_hack"].weight, 99);
    }
}
