//! Branded sponsor tokens (Issue #1258).
//!
//! The Soroban `sponsored-token` contract is what moves the tokens. This
//! service keeps the same rules — one custom asset per sponsor, a trustline
//! before a balance can change, and a pool that cannot be overdrawn — and
//! returns the contract call the distribution corresponds to. Brand metadata
//! is what the UI renders.

use crate::api_error::ApiError;
use crate::auth::jwt_service::JwtService;
use crate::http::auth_handler::ACCESS_TOKEN_COOKIE;
use crate::service::community_leaderboard::normalize_slug;
use crate::service::stellar_service::{stellar_strkey_decode, stellar_strkey_encode};
use actix_web::{web, HttpRequest, HttpResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

const CONTRACT: &str = "sponsored-token";
const PUBLIC_KEY_VERSION: u8 = 6 << 3;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SponsorError {
    Invalid(String),
    NotFound,
    Conflict(String),
}

impl std::fmt::Display for SponsorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SponsorError::Invalid(reason) => write!(f, "{reason}"),
            SponsorError::NotFound => write!(f, "Unknown sponsor"),
            SponsorError::Conflict(reason) => write!(f, "{reason}"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Brand {
    pub sponsor_id: String,
    pub asset_code: String,
    pub name: String,
    pub logo_url: String,
    pub color: String,
    pub issuer: String,
    pub pool: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ContractCall {
    pub contract: &'static str,
    pub function: &'static str,
    pub sponsor_id: String,
    pub recipient: String,
    pub amount: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Distribution {
    pub call: ContractCall,
    pub recipient_balance: i64,
    pub brand: Brand,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Trustline {
    sponsor_id: String,
    participant: String,
}

struct Ledger {
    brands: Vec<Brand>,
    trustlines: Vec<Trustline>,
    balances: Vec<(String, String, i64)>,
}

pub struct SponsoredTokens {
    ledger: Mutex<Ledger>,
}

impl SponsoredTokens {
    pub fn new() -> Self {
        Self {
            ledger: Mutex::new(Ledger {
                brands: Vec::new(),
                trustlines: Vec::new(),
                balances: Vec::new(),
            }),
        }
    }

    pub async fn register(&self, brand: Brand) -> Result<Brand, SponsorError> {
        let brand = validate_brand(brand)?;
        let mut ledger = self.ledger.lock().await;
        if ledger
            .brands
            .iter()
            .any(|row| row.sponsor_id == brand.sponsor_id)
        {
            return Err(SponsorError::Conflict(
                "Sponsor is already registered".into(),
            ));
        }
        if ledger
            .brands
            .iter()
            .any(|row| row.asset_code == brand.asset_code)
        {
            return Err(SponsorError::Conflict(
                "Asset code is already in use".into(),
            ));
        }
        ledger.brands.push(brand.clone());
        Ok(brand)
    }

    pub async fn brands(&self) -> Vec<Brand> {
        self.ledger.lock().await.brands.clone()
    }

    pub async fn open_trustline(
        &self,
        sponsor_id: &str,
        participant: &str,
    ) -> Result<(), SponsorError> {
        let sponsor_id =
            normalize_slug(sponsor_id).map_err(|error| SponsorError::Invalid(error.to_string()))?;
        let participant = public_key(participant)?;
        let mut ledger = self.ledger.lock().await;
        if !ledger.brands.iter().any(|row| row.sponsor_id == sponsor_id) {
            return Err(SponsorError::NotFound);
        }
        if !ledger
            .trustlines
            .iter()
            .any(|row| row.sponsor_id == sponsor_id && row.participant == participant)
        {
            ledger.trustlines.push(Trustline {
                sponsor_id,
                participant,
            });
        }
        Ok(())
    }

    /// Apply the sponsored-token contract's `distribute` rules and return the
    /// call the chain executes.
    pub async fn distribute(
        &self,
        sponsor_id: &str,
        recipient: &str,
        amount: i64,
    ) -> Result<Distribution, SponsorError> {
        if amount <= 0 {
            return Err(SponsorError::Invalid("amount must be positive".into()));
        }
        let sponsor_id =
            normalize_slug(sponsor_id).map_err(|error| SponsorError::Invalid(error.to_string()))?;
        let recipient = public_key(recipient)?;
        let mut ledger = self.ledger.lock().await;
        if !ledger.brands.iter().any(|row| row.sponsor_id == sponsor_id) {
            return Err(SponsorError::NotFound);
        }
        let trusted = ledger
            .trustlines
            .iter()
            .any(|row| row.sponsor_id == sponsor_id && row.participant == recipient);
        if !trusted {
            return Err(SponsorError::Invalid("recipient has no trustline".into()));
        }
        let brand = {
            let Some(brand) = ledger
                .brands
                .iter_mut()
                .find(|row| row.sponsor_id == sponsor_id)
            else {
                return Err(SponsorError::NotFound);
            };
            if amount > brand.pool {
                return Err(SponsorError::Invalid("amount exceeds sponsor pool".into()));
            }
            brand.pool -= amount;
            brand.clone()
        };
        let balance = if let Some(row) = ledger
            .balances
            .iter_mut()
            .find(|row| row.0 == sponsor_id && row.1 == recipient)
        {
            row.2 += amount;
            row.2
        } else {
            ledger
                .balances
                .push((sponsor_id.clone(), recipient.clone(), amount));
            amount
        };
        Ok(Distribution {
            call: ContractCall {
                contract: CONTRACT,
                function: "distribute",
                sponsor_id,
                recipient,
                amount,
            },
            recipient_balance: balance,
            brand,
        })
    }
}

impl Default for SponsoredTokens {
    fn default() -> Self {
        Self::new()
    }
}

pub fn validate_brand(mut brand: Brand) -> Result<Brand, SponsorError> {
    brand.sponsor_id = normalize_slug(&brand.sponsor_id)
        .map_err(|error| SponsorError::Invalid(error.to_string()))?;
    brand.asset_code = brand.asset_code.trim().to_ascii_uppercase();
    if !(1..=12).contains(&brand.asset_code.len())
        || !brand.asset_code.chars().all(|c| c.is_ascii_alphanumeric())
    {
        return Err(SponsorError::Invalid(
            "Asset code must be 1-12 letters or numbers".into(),
        ));
    }
    brand.name = brand.name.trim().to_string();
    if brand.name.is_empty() || brand.name.chars().count() > 64 {
        return Err(SponsorError::Invalid(
            "Brand name must be 1-64 characters".into(),
        ));
    }
    if !brand.logo_url.starts_with("https://") {
        return Err(SponsorError::Invalid(
            "Logo URL must start with https://".into(),
        ));
    }
    if !valid_color(&brand.color) {
        return Err(SponsorError::Invalid("Brand color must be #rrggbb".into()));
    }
    brand.issuer = public_key(&brand.issuer)?;
    if brand.pool <= 0 {
        return Err(SponsorError::Invalid("Pool must be positive".into()));
    }
    Ok(brand)
}

fn valid_color(color: &str) -> bool {
    let Some(hex) = color.strip_prefix('#') else {
        return false;
    };
    hex.len() == 6 && hex.chars().all(|c| c.is_ascii_hexdigit())
}

fn public_key(input: &str) -> Result<String, SponsorError> {
    let (version, payload) = stellar_strkey_decode(input.trim())
        .map_err(|_| SponsorError::Invalid("Stellar public key is invalid".into()))?;
    if version != PUBLIC_KEY_VERSION || payload.len() != 32 {
        return Err(SponsorError::Invalid(
            "Stellar public key is invalid".into(),
        ));
    }
    stellar_strkey_encode(version, &payload)
        .map_err(|_| SponsorError::Invalid("Stellar public key is invalid".into()))
}

fn map_error(error: SponsorError) -> ApiError {
    match error {
        SponsorError::NotFound => ApiError::not_found("missing"),
        SponsorError::Conflict(message) => ApiError::conflict(message),
        SponsorError::Invalid(message) => ApiError::bad_request(message),
    }
}

#[derive(Debug, Deserialize)]
struct TrustlineBody {
    participant: String,
}

#[derive(Debug, Deserialize)]
struct DistributeBody {
    recipient: String,
    amount: i64,
}

async fn caller(
    req: &HttpRequest,
    jwt: &JwtService,
) -> Result<crate::auth::jwt_service::Claims, ApiError> {
    let token = req
        .headers()
        .get("Authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::to_owned)
        .or_else(|| {
            req.cookie(ACCESS_TOKEN_COOKIE)
                .map(|cookie| cookie.value().to_string())
        })
        .ok_or_else(|| ApiError::unauthorized("Authentication required"))?;
    jwt.validate_token(&token)
        .await
        .map_err(|_| ApiError::unauthorized("Authentication required"))
}

async fn list_brands(tokens: web::Data<Arc<SponsoredTokens>>) -> Result<HttpResponse, ApiError> {
    Ok(HttpResponse::Ok().json(tokens.brands().await))
}

async fn register_sponsor(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    tokens: web::Data<Arc<SponsoredTokens>>,
    body: web::Json<Brand>,
) -> Result<HttpResponse, ApiError> {
    let claims = caller(&req, jwt.get_ref()).await?;
    if !claims.roles.iter().any(|role| role == "admin") {
        return Err(ApiError::forbidden("Admin access required"));
    }
    let brand = tokens
        .register(body.into_inner())
        .await
        .map_err(map_error)?;
    Ok(HttpResponse::Ok().json(brand))
}

async fn open_trustline(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    tokens: web::Data<Arc<SponsoredTokens>>,
    sponsor_id: web::Path<String>,
    body: web::Json<TrustlineBody>,
) -> Result<HttpResponse, ApiError> {
    let claims = caller(&req, jwt.get_ref()).await?;
    Uuid::parse_str(&claims.sub).map_err(|_| ApiError::unauthorized("Invalid user ID in token"))?;
    tokens
        .open_trustline(&sponsor_id, &body.participant)
        .await
        .map_err(map_error)?;
    Ok(HttpResponse::Ok().json(serde_json::json!({
        "contract": CONTRACT,
        "function": "open_trustline",
        "sponsor_id": sponsor_id.into_inner(),
    })))
}

async fn distribute_tokens(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    tokens: web::Data<Arc<SponsoredTokens>>,
    sponsor_id: web::Path<String>,
    body: web::Json<DistributeBody>,
) -> Result<HttpResponse, ApiError> {
    let claims = caller(&req, jwt.get_ref()).await?;
    if !claims.roles.iter().any(|role| role == "admin") {
        return Err(ApiError::forbidden("Admin access required"));
    }
    let distribution = tokens
        .distribute(&sponsor_id, &body.recipient, body.amount)
        .await
        .map_err(map_error)?;
    Ok(HttpResponse::Ok().json(distribution))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/api/sponsors")
            .route("", web::get().to(list_brands))
            .route("", web::post().to(register_sponsor))
            .route("/{sponsor_id}/trustline", web::post().to(open_trustline))
            .route(
                "/{sponsor_id}/distribute",
                web::post().to(distribute_tokens),
            ),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::stellar_service::stellar_strkey_encode;

    fn key(seed: u8) -> String {
        let mut payload = [0u8; 32];
        payload[0] = seed;
        stellar_strkey_encode(PUBLIC_KEY_VERSION, &payload).unwrap()
    }

    fn brand() -> Brand {
        Brand {
            sponsor_id: "Acme".into(),
            asset_code: "acme".into(),
            name: "Acme Cup".into(),
            logo_url: "https://cdn.example/acme.png".into(),
            color: "#112233".into(),
            issuer: key(1),
            pool: 1_000,
        }
    }

    #[tokio::test]
    async fn distribution_uses_the_contract_and_requires_a_trustline() {
        let tokens = SponsoredTokens::new();
        let stored = tokens.register(brand()).await.unwrap();
        assert_eq!(stored.sponsor_id, "acme");
        assert_eq!(stored.asset_code, "ACME");

        let recipient = key(2);
        assert!(tokens.distribute("acme", &recipient, 10).await.is_err());
        tokens.open_trustline("acme", &recipient).await.unwrap();

        let distribution = tokens.distribute("acme", &recipient, 10).await.unwrap();
        assert_eq!(distribution.call.contract, "sponsored-token");
        assert_eq!(distribution.call.function, "distribute");
        assert_eq!(distribution.recipient_balance, 10);
        assert_eq!(distribution.brand.pool, 990);
        assert_eq!(distribution.brand.color, "#112233");
        assert!(distribution.brand.logo_url.starts_with("https://"));

        assert!(tokens.distribute("acme", &recipient, 991).await.is_err());
    }

    #[test]
    fn brand_metadata_rejects_a_bad_color_and_logo() {
        let mut sample = brand();
        sample.color = "red";
        assert!(validate_brand(sample).is_err());
        let mut sample = brand();
        sample.logo_url = "http://cdn.example/acme.png".into();
        assert!(validate_brand(sample).is_err());
    }
}
