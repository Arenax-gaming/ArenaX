use serde::{Deserialize, Serialize};

/// Generic single-item success response wrapper.
///
/// ```json
/// { "data": { ... } }
/// ```
#[derive(Debug, Serialize)]
pub struct ApiResponse<T: Serialize> {
    pub data: T,
}

impl<T: Serialize> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self { data }
    }
}

/// Shared pagination query parameters accepted by all list endpoints.
///
/// Supports both `?page=1&limit=20` (page-based) and
/// `?offset=0&limit=20` (offset-based) styles.  When `offset` is supplied it
/// takes precedence over `page`.
///
/// The resolved offset used in SQL is available via
/// [`PaginationParams::sql_offset`].
#[derive(Debug, Clone, Deserialize)]
pub struct PaginationParams {
    /// 1-indexed page number (default: 1).
    pub page: Option<i64>,

    /// Zero-based row offset.  If present, overrides `page`.
    pub offset: Option<i64>,

    /// Maximum number of rows to return.  Silently clamped to
    /// [`MAX_LIMIT`] server-side.  Defaults to [`DEFAULT_LIMIT`].
    pub limit: Option<i64>,
}

/// Default page size when the caller does not specify one.
pub const DEFAULT_LIMIT: i64 = 20;

/// Hard cap on rows returned per request.  Requests for more are clamped
/// silently.
pub const MAX_LIMIT: i64 = 100;

impl PaginationParams {
    /// Resolved limit, clamped to [1, MAX_LIMIT].
    pub fn resolved_limit(&self) -> i64 {
        self.limit
            .unwrap_or(DEFAULT_LIMIT)
            .max(1)
            .min(MAX_LIMIT)
    }

    /// Resolved page (1-indexed), minimum 1.
    pub fn resolved_page(&self) -> i64 {
        self.page.unwrap_or(1).max(1)
    }

    /// Zero-based SQL OFFSET value.
    ///
    /// If `offset` is explicitly supplied it is used as-is (floored at 0).
    /// Otherwise, `(page - 1) * limit` is used.
    pub fn sql_offset(&self) -> i64 {
        if let Some(off) = self.offset {
            off.max(0)
        } else {
            (self.resolved_page() - 1) * self.resolved_limit()
        }
    }
}

/// Standard paginated response envelope returned by all list endpoints.
///
/// ```json
/// {
///   "data": [...],
///   "total": 250,
///   "page": 2,
///   "limit": 20
/// }
/// ```
#[derive(Debug, Serialize)]
pub struct PaginatedResponse<T: Serialize> {
    pub data: Vec<T>,
    pub total: i64,
    pub page: i64,
    pub limit: i64,
}

impl<T: Serialize> PaginatedResponse<T> {
    pub fn new(data: Vec<T>, total: i64, params: &PaginationParams) -> Self {
        let limit = params.resolved_limit();
        // If the caller passed an explicit offset, report the effective page
        // number; if offset isn't cleanly divisible it rounds up to the
        // containing page.
        let page = if params.offset.is_some() {
            let off = params.sql_offset();
            if limit == 0 {
                1
            } else {
                (off / limit) + 1
            }
        } else {
            params.resolved_page()
        };

        Self {
            data,
            total,
            page,
            limit,
        }
    }
}
