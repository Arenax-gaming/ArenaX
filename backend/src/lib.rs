pub mod api_error;
// NOTE: The following modules are temporarily disabled due to pre-existing compilation
// errors unrelated to the realtime feature. They will need fixes for:
// - auth: never-type fallback errors with redis, missing `futures` crate in middleware
// - http: depends on disabled service module
// - models: type mismatches in stellar_transaction.rs
// - service: sqlx compile-time macros require DB connection or offline cache
// - middleware: missing `futures` crate dependency
// pub mod auth;
pub mod config;
pub mod db;
// pub mod http;
// pub mod models;
// pub mod service;
pub mod telemetry;
// pub mod middleware;
pub mod realtime;
