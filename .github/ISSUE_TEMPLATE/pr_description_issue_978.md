# Pull Request for Issue #978: API Key Rotation System

## Overview
This PR implements a comprehensive API Key Rotation System with structured permissions management, usage tracking, and revocation mechanisms.

## Summary of Changes

### Files Added
- `backend/migrations/20260827000001_api_key_rotation.up.sql` - Database schema for API key rotation
- `backend/migrations/20260827000001_api_key_rotation.down.sql` - Rollback migration
- `backend/src/models/api_key.rs` - API key data models and DTOs
- `backend/src/service/api_key_service.rs` - Business logic for API key management
- `backend/src/http/api_key.rs` - HTTP API endpoints

### Files Modified
- `.github/CODEOWNERS` - Added API key service ownership
- `.gitignore` - Added PULL_REQUEST.md pattern

## Acceptance Criteria Met

### ✅ Key Generation/Rotation
- Cryptographically secure key generation using 32-byte random bytes
- URL-safe base64 encoding without padding
- Configurable rotation intervals (days/hours/minutes)
- Automatic old key invalidation on rotation

### ✅ Scoped Permissions Per Key
- `scopes: Vec<String>` field for per-key permission definitions
- `scopes_used` tracking in usage logs for audit trail
- Support for API Key, Service Key, and Partner Key types

### ✅ Expiration Dates
- Configurable `expiration_date` per key
- `next_rotation_date` for scheduled rotation
- Automatic status updates: active, expired, rotation_due

### ✅ Usage Tracking
- `api_key_usage_logs` table with full request metadata
- Fields: endpoint, method, client_ip, user_agent, status codes, duration
- Per-key `use_count` and `max_uses` limits

### ✅ Revocation Mechanism
- Soft-delete with `is_active=false`
- `revoked_at` and `revoked_by` metadata
- `api_key_rotation_history` for complete audit trail

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/api-keys` | Create new API key |
| GET | `/api/api-keys` | List user's API keys |
| GET | `/api/api-keys/{key_id}` | Get key details |
| PUT | `/api/api-keys/{key_id}` | Update key configuration |
| DELETE | `/api/api-keys/{key_id}` | Revoke key |
| POST | `/api/api-keys/{key_id}/rotate` | Rotate key |
| GET | `/api/api-keys/{key_id}/usage` | Get usage logs |
| GET | `/api/api-keys/stats` | Get aggregate statistics |

## Database Schema

### api_keys Table
- `id` - Primary key (UUID)
- `key` - SHA-256 hash of the actual key (stored securely)
- `name`, `description` - User-provided metadata
- `user_id` - Owner reference
- `key_type` - api_key/service_key/partner_key
- `scopes` - Permission scopes array
- `expiration_date`, `next_rotation_date` - Time-based constraints
- `is_active`, `rotation_enabled` - Configuration flags
- `max_uses`, `use_count` - Usage limits
- `created_at`, `updated_at`, `last_used_at` - Timestamps

### api_key_usage_logs Table
- Full audit trail of all API key usage

### api_key_rotation_history Table
- Records all key rotations with old/new hashes

### api_key_summaries View
- Computed status: active/revoked/expired/max_uses_exceeded/rotation_due

## Security Considerations
- Keys are stored as SHA-256 hashes, never in plaintext
- Rotation history maintains hash references for forensic audit
- Usage logs capture IP addresses for security analysis
- Revocation properly invalidates keys before deletion

## Testing
- [ ] Migrations apply cleanly on fresh database
- [ ] Key generation produces unique, secure keys
- [ ] Rotation invalidates old key correctly
- [ ] Usage tracking captures all required fields
- [ ] Expiration logic updates status correctly
- [ ] Revocation prevents further API access
- [ ] Scopes are properly validated

## Migration Notes
Run before deploying:
```bash
cd backend
sqlx migrate run
```

Rollback if needed:
```bash
sqlx migrate revert
```

## Related Issues
closes #978

## Dependencies Added
- `base64` crate for URL-safe key encoding
- `sha2` crate for key hashing
