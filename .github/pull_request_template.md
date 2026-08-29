# Pull Request Template for ArenaX

## Issue Reference
Issue: #978 - API Key Rotation System

## Description
Implemented a comprehensive API Key Rotation System with structured permissions management, usage tracking, and revocation mechanisms.

## Changes Summary

### New Files
- `backend/migrations/20260827000001_api_key_rotation.up.sql` - Database schema for API key rotation system
- `backend/migrations/20260827000001_api_key_rotation.down.sql` - Rollback migration
- `backend/src/models/api_key.rs` - API key data models and DTOs
- `backend/src/service/api_key_service.rs` - Business logic for API key management
- `backend/src/http/api_key.rs` - HTTP API endpoints for API key operations

### Modified Files
- `.github/CODEOWNERS` - Added API key related file ownership

### Database Schema Changes
- `api_keys` - Main table with key properties, rotation settings, usage tracking
- `api_key_usage_logs` - Audit trail for all API key usage
- `api_key_rotation_history` - Records all key rotations with hashes
- `api_key_summaries` - View with computed status (active/revoked/expired/max_uses_exceeded/rotation_due)

## Features Implemented

### ✅ Key Generation & Rotation
- Cryptographically secure key generation (32-byte random, URL-safe base64)
- Key rotation with automatic old key invalidation
- Configurable rotation intervals (30d, 90d, 180d, etc.)

### ✅ Scoped Permissions
- Per-key scope definitions (`scopes: Vec<String>`)
- Usage tracking with scope-level audit

### ✅ Expiration Management
- Configurable expiration dates
- Automatic status tracking (expired, rotation_due)
- Rotation scheduling with next_rotation_date

### ✅ Usage Tracking
- Full request audit trail (endpoint, method, duration, status codes)
- Per-key usage counters
- Maximum use limits with automatic enforcement

### ✅ Revocation Mechanism
- Soft-delete with is_active flag
- Revocation metadata (revoked_at, revoked_by, reason)
- Complete rotation history tracking

## API Endpoints
```
POST   /api/api-keys              - Create new API key
GET    /api/api-keys              - List user's API keys
GET    /api/api-keys/{key_id}     - Get key details
PUT    /api/api-keys/{key_id}     - Update key configuration
DELETE /api/api-keys/{key_id}     - Revoke key
POST   /api/api-keys/{key_id}/rotate - Rotate key
GET    /api/api-keys/{key_id}/usage - Get usage logs
GET    /api/api-keys/stats        - Get aggregate statistics
```

## Testing Checklist
- [ ] Database migrations apply cleanly
- [ ] Key generation produces unique, secure keys
- [ ] Rotation invalidates old key and creates valid new key
- [ ] Usage tracking records all required fields
- [ ] Expiration status updates correctly
- [ ] Revocation prevents further API usage
- [ ] Scopes are enforced during key validation

## Dependencies
- `base64` crate for URL-safe key encoding
- `sha2` crate for key hashing (SHA-256)
- `chrono` crate for date/time handling

## Breaking Changes
None - this is a new feature.

## Additional Notes
- Keys are stored as SHA-256 hashes in the database for security
- Rotation history maintains both old and new key hashes for audit
- Usage logs can be queried with pagination (limit/offset)
