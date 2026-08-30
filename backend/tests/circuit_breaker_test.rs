use std::time::Duration;

#[path = "../src/middleware/circuit_breaker.rs"]
mod circuit_breaker;

use circuit_breaker::{
    CircuitBreaker, CircuitBreakerConfig, CircuitBreakerError, CircuitBreakerRegistry,
    CircuitState,
};

fn run_async<F: std::future::Future>(f: F) -> F::Output {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(f)
}

#[test]
fn test_circuit_breaker_normal_execution() {
    run_async(async {
        let config = CircuitBreakerConfig::new("stellar_horizon")
            .with_failure_threshold(3)
            .with_initial_backoff(Duration::from_millis(50));
        let breaker = CircuitBreaker::new(config);

        assert_eq!(breaker.state(), CircuitState::Closed);

        let res = breaker.call(|| async { Ok::<&str, &str>("account_data") }).await;
        assert_eq!(res.unwrap(), "account_data");

        let stats = breaker.stats();
        assert_eq!(stats.total_successes, 1);
        assert_eq!(stats.total_failures, 0);
        assert_eq!(stats.consecutive_failures, 0);
    });
}

#[test]
fn test_circuit_trips_to_open_after_threshold_failures() {
    run_async(async {
        let config = CircuitBreakerConfig::new("soroban_rpc")
            .with_failure_threshold(3)
            .with_initial_backoff(Duration::from_millis(100));
        let breaker = CircuitBreaker::new(config);

        for i in 1..=2 {
            let _ = breaker
                .call(|| async { Err::<(), &str>("rpc connection timeout") })
                .await;
            assert_eq!(breaker.state(), CircuitState::Closed, "Should stay closed at failure {}", i);
        }

        // 3rd failure trips the breaker open
        let err = breaker
            .call(|| async { Err::<(), &str>("rpc connection timeout") })
            .await;
        assert!(err.is_err());
        assert_eq!(breaker.state(), CircuitState::Open);

        // Fast-fail: subsequent call is rejected immediately with CircuitOpen error
        let fast_fail_err = breaker
            .call(|| async { Ok::<&str, &str>("should not be called") })
            .await;

        match fast_fail_err {
            Err(CircuitBreakerError::CircuitOpen { service, retry_after_secs }) => {
                assert_eq!(service, "soroban_rpc");
                assert!(retry_after_secs <= 1);
            }
            _ => panic!("Expected CircuitOpen error, got {:?}", fast_fail_err),
        }

        let stats = breaker.stats();
        assert_eq!(stats.trip_count, 1);
        assert_eq!(stats.total_rejected, 1);
    });
}

#[test]
fn test_exponential_backoff_cooldown_growth() {
    run_async(async {
        let config = CircuitBreakerConfig::new("webhook_service")
            .with_failure_threshold(2)
            .with_initial_backoff(Duration::from_millis(50))
            .with_backoff_multiplier(2.0)
            .with_max_backoff(Duration::from_millis(400));
        let breaker = CircuitBreaker::new(config);

        // Trip 1
        breaker.record_failure();
        breaker.record_failure();
        assert_eq!(breaker.state(), CircuitState::Open);
        let stats1 = breaker.stats();
        assert_eq!(stats1.trip_count, 1);
        assert_eq!(stats1.current_cooldown_secs, 0); // 50ms is 0 full secs

        // Wait for cooldown to expire -> Half-Open
        tokio::time::sleep(Duration::from_millis(60)).await;
        assert_eq!(breaker.state(), CircuitState::HalfOpen);

        // Fail during probe -> Trip 2
        breaker.record_failure();
        assert_eq!(breaker.state(), CircuitState::Open);
        let stats2 = breaker.stats();
        assert_eq!(stats2.trip_count, 2);
    });
}

#[test]
fn test_half_open_recovery_to_closed() {
    run_async(async {
        let config = CircuitBreakerConfig::new("payment_gateway")
            .with_failure_threshold(2)
            .with_success_threshold(2)
            .with_initial_backoff(Duration::from_millis(40));
        let breaker = CircuitBreaker::new(config);

        // Trip the breaker
        breaker.record_failure();
        breaker.record_failure();
        assert_eq!(breaker.state(), CircuitState::Open);

        // Wait for cooldown -> HalfOpen
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(breaker.state(), CircuitState::HalfOpen);

        // Probe 1 succeeds
        let res1 = breaker.call(|| async { Ok::<i32, ()>(100) }).await;
        assert_eq!(res1.unwrap(), 100);
        assert_eq!(breaker.state(), CircuitState::HalfOpen);

        // Probe 2 succeeds -> meets threshold -> transitions to Closed
        let res2 = breaker.call(|| async { Ok::<i32, ()>(200) }).await;
        assert_eq!(res2.unwrap(), 200);
        assert_eq!(breaker.state(), CircuitState::Closed);

        let stats = breaker.stats();
        assert_eq!(stats.consecutive_failures, 0);
        assert_eq!(stats.trip_count, 0);
    });
}

#[test]
fn test_registry_manages_multiple_services_independently() {
    let registry = CircuitBreakerRegistry::default();

    let stellar = registry.get_or_create("stellar");
    let soroban = registry.get_or_create("soroban");
    let discord = registry.get_or_create("discord_webhook");

    stellar.manual_trip();
    assert_eq!(stellar.state(), CircuitState::Open);
    assert_eq!(soroban.state(), CircuitState::Closed);
    assert_eq!(discord.state(), CircuitState::Closed);

    let all_stats = registry.all_stats();
    assert_eq!(all_stats.len(), 3);
}

#[test]
fn test_request_timeout_triggers_failure() {
    run_async(async {
        let config = CircuitBreakerConfig::new("slow_service")
            .with_failure_threshold(1)
            .with_request_timeout(Duration::from_millis(30))
            .with_initial_backoff(Duration::from_millis(100));
        let breaker = CircuitBreaker::new(config);

        let res = breaker
            .call(|| async {
                tokio::time::sleep(Duration::from_millis(100)).await;
                Ok::<(), ()>(())
            })
            .await;

        match res {
            Err(CircuitBreakerError::Timeout(dur)) => {
                assert_eq!(dur, Duration::from_millis(30));
            }
            _ => panic!("Expected Timeout error, got {:?}", res),
        }

        assert_eq!(breaker.state(), CircuitState::Open);
    });
}
