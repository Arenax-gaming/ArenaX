/// CSRF protection via the double-submit-cookie pattern.
///
/// On any response where the caller doesn't yet hold a CSRF cookie, we mint
/// one (`csrf_token`). It is intentionally *not* `HttpOnly` so client-side
/// JS can read it and echo it back on the `X-CSRF-Token` header. On
/// state-changing requests (POST/PUT/PATCH/DELETE) we require that header to
/// match the cookie. A cross-site page can trigger a request carrying the
/// cookie (browsers attach cookies automatically), but it cannot read the
/// cookie's value to set the matching header (same-origin policy), which is
/// what defeats CSRF here.
///
/// `SameSite=Strict` on both this cookie and the auth cookies
/// (`backend/src/http/auth_handler.rs`) is defense in depth: modern
/// browsers already stop the cookie being sent cross-site, and this check
/// stops the remaining cross-site-navigation edge cases.
use actix_web::{
    body::{BoxBody, MessageBody},
    cookie::{Cookie, SameSite},
    dev::{ServiceRequest, ServiceResponse},
    http::Method,
    middleware::Next,
    Error, HttpMessage, HttpResponse,
};
use rand::RngCore;

pub const CSRF_COOKIE: &str = "csrf_token";
pub const CSRF_HEADER: &str = "X-CSRF-Token";

/// `GET /api/csrf-token` — lets clients that don't yet hold a `csrf_token`
/// cookie fetch one before making their first mutating request. The cookie
/// itself is minted by [`csrf_protection`], not this handler.
pub async fn csrf_token_handler() -> HttpResponse {
    HttpResponse::Ok().json(serde_json::json!({ "status": "ok" }))
}

/// Paths exempt from the header/cookie match check.
///
/// Safe methods (GET/HEAD/OPTIONS/TRACE) are always exempt since they must
/// not mutate state. These additional exemptions cover endpoints reached
/// before a session (and therefore a CSRF cookie) can exist.
fn is_exempt(path: &str) -> bool {
    path.starts_with("/api/auth/login")
        || path.starts_with("/api/auth/register")
        || path.starts_with("/api/auth/refresh")
        || path.starts_with("/api/health")
        || path.starts_with("/api/csrf-token")
}

fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn is_state_changing(method: &Method) -> bool {
    matches!(
        *method,
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    )
}

/// `actix_web::middleware::from_fn` handler — validates CSRF tokens on
/// mutating requests and mints a fresh CSRF cookie for sessions that don't
/// have one yet.
pub async fn csrf_protection(
    req: ServiceRequest,
    next: Next<impl MessageBody + 'static>,
) -> Result<ServiceResponse<BoxBody>, Error> {
    let method = req.method().clone();
    let path = req.path().to_string();

    if is_state_changing(&method) && !is_exempt(&path) {
        let cookie_token = req.cookie(CSRF_COOKIE).map(|c| c.value().to_string());
        let header_token = req
            .headers()
            .get(CSRF_HEADER)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        let valid = matches!(
            (&cookie_token, &header_token),
            (Some(c), Some(h)) if !c.is_empty() && c == h
        );

        if !valid {
            let response = HttpResponse::Forbidden().json(serde_json::json!({
                "error": "csrf_validation_failed",
                "message": "Missing or invalid CSRF token. Fetch one from GET /api/csrf-token \
                             and send it back on the X-CSRF-Token header for this request."
            }));
            return Ok(req.into_response(response).map_into_boxed_body());
        }
    }

    let needs_new_cookie = req.cookie(CSRF_COOKIE).is_none();
    let res = next.call(req).await?;
    let mut res = res.map_into_boxed_body();

    if needs_new_cookie {
        let token = generate_token();
        let cookie = Cookie::build(CSRF_COOKIE, token)
            .path("/")
            .http_only(false)
            .secure(true)
            .same_site(SameSite::Strict)
            .finish();
        let _ = res.response_mut().add_cookie(&cookie);
    }

    Ok(res)
}
