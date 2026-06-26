use crate::{
    api_error::ApiError,
    service::soroban_service::{NetworkConfig, SorobanService},
};
use actix_web::{web, HttpResponse};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct GasEstimationRequest {
    pub contract_id: String,
    pub function_name: String,
    pub args: serde_json::Value,
    pub signer_secret: String,
}

#[derive(Serialize)]
pub struct GasEstimationResponse {
    pub cpu_instructions: u64,
    pub memory_bytes: u64,
    pub min_resource_fee: String,
    pub est_fee_stroops: u64,
}

pub async fn estimate(
    body: web::Json<GasEstimationRequest>,
) -> Result<HttpResponse, ApiError> {
    // In production, we'd read the network configuration from application state
    let network = NetworkConfig::testnet();
    let service = SorobanService::new(network);

    let res = service.estimate_gas(
        &body.contract_id,
        &body.function_name,
        &body.args,
        &body.signer_secret,
    )
    .await
    .map_err(|e| ApiError::InternalServerError(format!("Gas estimation failed: {}", e)))?;

    // Convert min resource fee (Stroops)
    let est_fee_stroops = res.min_resource_fee.parse::<u64>().unwrap_or(0);

    Ok(HttpResponse::Ok().json(GasEstimationResponse {
        cpu_instructions: res.cpu_instructions,
        memory_bytes: res.memory_bytes,
        min_resource_fee: res.min_resource_fee,
        est_fee_stroops,
    }))
}
