use crate::api_error::ApiError;
use crate::models::{
    Friend, FriendRequest, Message, Conversation, Party, PartyMember, CommunityPost,
    OnlineStatus, SocialNotification, FriendsListResponse, FeedPage,
    BlockEntry, BlockListResponse, BlockRequest,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

/// Default page size for the community feed.
pub const DEFAULT_FEED_LIMIT: i64 = 20;
/// Hard cap on feed page size, whatever the client asks for.
pub const MAX_FEED_LIMIT: i64 = 50;

/// Keyset position in the community feed: the `(created_at, id)` of the last
/// post already returned (#1528).
///
/// Ordering is `(created_at DESC, id DESC)` and the table's index matches it, so
/// the comparison is a single index seek instead of the scan-and-discard an
/// `OFFSET` performs. Because the position is a value rather than a count,
/// posts inserted or deleted between requests cannot shift the window, which is
/// what makes offset paging skip and repeat rows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FeedCursor {
    pub created_at: DateTime<Utc>,
    pub id: Uuid,
}

impl FeedCursor {
    pub fn new(created_at: DateTime<Utc>, id: Uuid) -> Self {
        Self { created_at, id }
    }

    /// Encode as an opaque, URL-safe token.
    ///
    /// Microseconds match Postgres `timestamptz` resolution, so a decoded
    /// cursor lands exactly on the row it was built from.
    pub fn encode(&self) -> String {
        URL_SAFE_NO_PAD.encode(format!(
            "{}:{}",
            self.created_at.timestamp_micros(),
            self.id
        ))
    }

    /// Decode a token produced by [`FeedCursor::encode`].
    ///
    /// Anything malformed is a client error (400), never a silent fallback to
    /// the first page — a bad cursor that silently restarts the feed would make
    /// clients loop over the same posts forever.
    pub fn decode(raw: &str) -> Result<Self, ApiError> {
        let invalid = || ApiError::BadRequest("Invalid feed cursor".to_string());

        let bytes = URL_SAFE_NO_PAD.decode(raw.trim()).map_err(|_| invalid())?;
        let text = String::from_utf8(bytes).map_err(|_| invalid())?;
        let (timestamp, id) = text.split_once(':').ok_or_else(invalid)?;

        let micros: i64 = timestamp.parse().map_err(|_| invalid())?;
        let created_at = DateTime::from_timestamp_micros(micros).ok_or_else(invalid)?;
        let id = Uuid::parse_str(id).map_err(|_| invalid())?;

        Ok(Self { created_at, id })
    }
}

/// Clamp a client-supplied page size into `1..=MAX_FEED_LIMIT`.
pub fn clamp_feed_limit(limit: Option<i64>) -> i64 {
    limit.unwrap_or(DEFAULT_FEED_LIMIT).clamp(1, MAX_FEED_LIMIT)
}

/// Community feed projection: the post plus the author fields and the viewer's
/// like flag, which is not stored on the row itself.
const FEED_SELECT: &str = r#"
    SELECT p.id,
           p.author_id,
           u.username AS author_username,
           u.avatar_url AS author_avatar,
           p.title,
           p.content,
           p.category,
           COALESCE(p.likes, 0) AS likes,
           COALESCE(p.comments, 0) AS comments,
           p.created_at,
           EXISTS (
               SELECT 1 FROM post_likes pl
               WHERE pl.post_id = p.id AND pl.user_id = $1
           ) AS is_liked
    FROM community_posts p
    JOIN users u ON u.id = p.author_id
    WHERE p.is_active = TRUE
"#;

fn feed_post_from_row(row: &sqlx::postgres::PgRow) -> Result<CommunityPost, ApiError> {
    use sqlx::Row;

    Ok(CommunityPost {
        id: row.try_get("id").map_err(ApiError::DatabaseError)?,
        author_id: row.try_get("author_id").map_err(ApiError::DatabaseError)?,
        author_username: row
            .try_get("author_username")
            .map_err(ApiError::DatabaseError)?,
        author_avatar: row
            .try_get("author_avatar")
            .map_err(ApiError::DatabaseError)?,
        title: row.try_get("title").map_err(ApiError::DatabaseError)?,
        content: row.try_get("content").map_err(ApiError::DatabaseError)?,
        category: row.try_get("category").map_err(ApiError::DatabaseError)?,
        likes: row.try_get("likes").map_err(ApiError::DatabaseError)?,
        comments: row.try_get("comments").map_err(ApiError::DatabaseError)?,
        is_liked: row.try_get("is_liked").map_err(ApiError::DatabaseError)?,
        created_at: row.try_get("created_at").map_err(ApiError::DatabaseError)?,
    })
}

/// Turn `limit + 1` fetched rows into a page, using the extra row only as the
/// "there is more" signal.
fn build_feed_page(mut posts: Vec<CommunityPost>, limit: i64, cursor_endpoint: bool) -> FeedPage {
    let has_more = posts.len() as i64 > limit;
    if has_more {
        posts.truncate(limit as usize);
    }

    let next_cursor = if cursor_endpoint && has_more {
        posts
            .last()
            .map(|post| FeedCursor::new(post.created_at, post.id).encode())
    } else {
        None
    };

    FeedPage {
        posts,
        next_cursor,
        has_more,
    }
}

pub struct SocialService {
    db_pool: PgPool,
}

impl SocialService {
    pub fn new(db_pool: PgPool) -> Self {
        Self { db_pool }
    }

    /// Get user's friends list
    pub async fn get_friends_list(&self, user_id: Uuid) -> Result<FriendsListResponse, ApiError> {
        let friends = sqlx::query_as::<_, (Uuid, String, Option<String>, bool, Option<chrono::DateTime<chrono::Utc>>, chrono::DateTime<chrono::Utc>)>(
            r#"
            SELECT u.id, u.username, u.avatar_url, u.is_active, u.last_login_at, f.created_at
            FROM friends f
            JOIN users u ON (f.friend_id = u.id OR f.user_id = u.id)
            WHERE (f.user_id = $1 OR f.friend_id = $1) AND f.status = 'accepted'
            AND u.id != $1
            ORDER BY u.is_active DESC, f.created_at DESC
            "#
        )
        .bind(user_id)
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        let online_count = friends.iter().filter(|(_, _, _, is_active, _, _)| *is_active).count() as i32;
        let total_count = friends.len() as i32;

        let friends_list = friends
            .into_iter()
            .map(|(id, username, avatar_url, is_online, last_seen, added_at)| {
                Friend {
                    id,
                    username,
                    avatar_url,
                    is_online,
                    last_seen,
                    added_at,
                }
            })
            .collect();

        Ok(FriendsListResponse {
            friends: friends_list,
            total_count,
            online_count,
        })
    }

    /// Send friend request
    pub async fn send_friend_request(
        &self,
        from_user_id: Uuid,
        to_user_id: Uuid,
    ) -> Result<FriendRequest, ApiError> {
        // Check if either user has blocked the other (mutual-block enforcement #1407)
        if self.is_blocked(from_user_id, to_user_id).await? {
            return Err(ApiError::BadRequest("Cannot send friend request to a blocked player".to_string()));
        }

        // Check if already friends
        let existing = sqlx::query_scalar::<_, Option<String>>(
            r#"
            SELECT status FROM friends 
            WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)
            "#
        )
        .bind(from_user_id)
        .bind(to_user_id)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        if existing.is_some() {
            return Err(ApiError::BadRequest("Already friends or request pending".to_string()));
        }

        let request_id = Uuid::new_v4();
        sqlx::query(
            r#"
            INSERT INTO friend_requests (id, from_user_id, to_user_id, status, created_at)
            VALUES ($1, $2, $3, 'pending', NOW())
            "#
        )
        .bind(request_id)
        .bind(from_user_id)
        .bind(to_user_id)
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        let (from_username, from_avatar) = sqlx::query_as::<_, (String, Option<String>)>(
            "SELECT username, avatar_url FROM users WHERE id = $1"
        )
        .bind(from_user_id)
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        Ok(FriendRequest {
            id: request_id,
            from_user_id,
            from_username,
            from_avatar,
            to_user_id,
            status: "pending".to_string(),
            created_at: Utc::now(),
        })
    }

    /// Accept friend request
    pub async fn accept_friend_request(
        &self,
        request_id: Uuid,
    ) -> Result<(), ApiError> {
        let (from_user_id, to_user_id) = sqlx::query_as::<_, (Uuid, Uuid)>(
            "SELECT from_user_id, to_user_id FROM friend_requests WHERE id = $1 AND status = 'pending'"
        )
        .bind(request_id)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?
        .ok_or_else(|| ApiError::NotFound)?;

        // Create friendship
        sqlx::query(
            r#"
            INSERT INTO friends (user_id, friend_id, status, created_at)
            VALUES ($1, $2, 'accepted', NOW())
            "#
        )
        .bind(from_user_id)
        .bind(to_user_id)
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        // Update request status
        sqlx::query(
            "UPDATE friend_requests SET status = 'accepted' WHERE id = $1"
        )
        .bind(request_id)
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        Ok(())
    }

    /// Send message
    pub async fn send_message(
        &self,
        from_user_id: Uuid,
        to_user_id: Uuid,
        content: String,
    ) -> Result<Message, ApiError> {
        // Block check: blocked players cannot send messages (#1407)
        if self.is_blocked(from_user_id, to_user_id).await? {
            return Err(ApiError::BadRequest("Cannot send message to a blocked player".to_string()));
        }

        let message_id = Uuid::new_v4();

        sqlx::query(
            r#"
            INSERT INTO messages (id, from_user_id, to_user_id, content, is_read, created_at)
            VALUES ($1, $2, $3, $4, false, NOW())
            "#
        )
        .bind(message_id)
        .bind(from_user_id)
        .bind(to_user_id)
        .bind(&content)
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        let from_username = sqlx::query_scalar::<_, String>(
            "SELECT username FROM users WHERE id = $1"
        )
        .bind(from_user_id)
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        Ok(Message {
            id: message_id,
            from_user_id,
            from_username,
            to_user_id,
            content,
            is_read: false,
            created_at: Utc::now(),
        })
    }

    /// Get conversations
    pub async fn get_conversations(&self, user_id: Uuid) -> Result<Vec<Conversation>, ApiError> {
        let conversations = sqlx::query_as::<_, (Uuid, Uuid, String, Option<String>, Option<String>, Option<chrono::DateTime<chrono::Utc>>, i32)>(
            r#"
            SELECT 
                COALESCE(m.id, gen_random_uuid()) as conv_id,
                u.id, u.username, u.avatar_url,
                m.content, m.created_at,
                (SELECT COUNT(*) FROM messages WHERE (from_user_id = u.id AND to_user_id = $1) AND is_read = false)::int as unread_count
            FROM (
                SELECT DISTINCT CASE WHEN from_user_id = $1 THEN to_user_id ELSE from_user_id END as other_user_id
                FROM messages WHERE from_user_id = $1 OR to_user_id = $1
            ) conv
            JOIN users u ON u.id = conv.other_user_id
            LEFT JOIN LATERAL (
                SELECT * FROM messages 
                WHERE (from_user_id = $1 AND to_user_id = u.id) OR (from_user_id = u.id AND to_user_id = $1)
                ORDER BY created_at DESC LIMIT 1
            ) m ON true
            ORDER BY m.created_at DESC NULLS LAST
            "#
        )
        .bind(user_id)
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        Ok(conversations
            .into_iter()
            .map(|(_, participant_id, participant_username, participant_avatar, last_message, last_message_at, unread_count)| {
                Conversation {
                    id: Uuid::new_v4(),
                    participant_id,
                    participant_username,
                    participant_avatar,
                    last_message,
                    last_message_at,
                    unread_count,
                }
            })
            .collect())
    }

    /// Create party
    pub async fn create_party(
        &self,
        leader_id: Uuid,
        name: String,
        description: Option<String>,
        max_members: i32,
    ) -> Result<Party, ApiError> {
        let party_id = Uuid::new_v4();

        sqlx::query(
            r#"
            INSERT INTO parties (id, leader_id, name, description, max_members, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            "#
        )
        .bind(party_id)
        .bind(leader_id)
        .bind(&name)
        .bind(&description)
        .bind(max_members)
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        // Add leader as member
        sqlx::query(
            r#"
            INSERT INTO party_members (party_id, user_id, role, joined_at)
            VALUES ($1, $2, 'leader', NOW())
            "#
        )
        .bind(party_id)
        .bind(leader_id)
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        let leader_username = sqlx::query_scalar::<_, String>(
            "SELECT username FROM users WHERE id = $1"
        )
        .bind(leader_id)
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        Ok(Party {
            id: party_id,
            leader_id,
            leader_username: leader_username.clone(),
            name,
            description,
            max_members,
            current_members: 1,
            members: vec![PartyMember {
                user_id: leader_id,
                username: leader_username,
                avatar_url: None,
                role: "leader".to_string(),
                joined_at: Utc::now(),
            }],
            created_at: Utc::now(),
        })
    }

    /// Get online status
    pub async fn get_online_status(&self, user_id: Uuid) -> Result<OnlineStatus, ApiError> {
        let (username, is_online, last_seen) = sqlx::query_as::<_, (String, bool, Option<chrono::DateTime<chrono::Utc>>)>(
            "SELECT username, is_active, last_login_at FROM users WHERE id = $1"
        )
        .bind(user_id)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?
        .ok_or_else(|| ApiError::NotFound)?;

        Ok(OnlineStatus {
            user_id,
            username,
            is_online,
            last_seen,
            status_message: None,
        })
    }

    /// Get pending friend requests
    pub async fn get_pending_requests(&self, user_id: Uuid) -> Result<Vec<FriendRequest>, ApiError> {
        let requests = sqlx::query_as::<_, (Uuid, Uuid, String, Option<String>, Uuid, chrono::DateTime<chrono::Utc>)>(
            r#"
            SELECT fr.id, fr.from_user_id, u.username, u.avatar_url, fr.to_user_id, fr.created_at
            FROM friend_requests fr
            JOIN users u ON fr.from_user_id = u.id
            WHERE fr.to_user_id = $1 AND fr.status = 'pending'
            ORDER BY fr.created_at DESC
            "#
        )
        .bind(user_id)
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        Ok(requests
            .into_iter()
            .map(|(id, from_user_id, from_username, from_avatar, to_user_id, created_at)| {
                FriendRequest {
                    id,
                    from_user_id,
                    from_username,
                    from_avatar,
                    to_user_id,
                    status: "pending".to_string(),
                    created_at,
                }
            })
            .collect())
    }

    // ───────────────────────────────────────────────────────────────────────
    // Block list (#1407)
    // ───────────────────────────────────────────────────────────────────────

    /// Block another player.  The block is bidirectional — both (A,B) and
    /// (B,A) rows are inserted so that a single `WHERE blocker_id = $1` query
    /// returns all users that $1 cannot interact with.
    pub async fn block_user(
        &self,
        blocker_id: Uuid,
        blocked_id: Uuid,
    ) -> Result<(), ApiError> {
        if blocker_id == blocked_id {
            return Err(ApiError::BadRequest("Cannot block yourself".to_string()));
        }

        // Insert both directions for mutual-block enforcement.
        sqlx::query(
            r#"
            INSERT INTO player_blocks (blocker_id, blocked_id)
            VALUES ($1, $2), ($2, $1)
            ON CONFLICT (blocker_id, blocked_id) DO NOTHING
            "#
        )
        .bind(blocker_id)
        .bind(blocked_id)
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        // Also remove any existing friendship between the two users.
        sqlx::query(
            r#"
            DELETE FROM friends
            WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)
            "#
        )
        .bind(blocker_id)
        .bind(blocked_id)
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        Ok(())
    }

    /// Unblock a previously blocked player.  Removes both directions.
    pub async fn unblock_user(
        &self,
        blocker_id: Uuid,
        blocked_id: Uuid,
    ) -> Result<(), ApiError> {
        sqlx::query(
            r#"
            DELETE FROM player_blocks
            WHERE (blocker_id = $1 AND blocked_id = $2)
               OR (blocker_id = $2 AND blocked_id = $1)
            "#
        )
        .bind(blocker_id)
        .bind(blocked_id)
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        Ok(())
    }

    /// Check if either user has blocked the other (mutual-block check).
    pub async fn is_blocked(
        &self,
        user_a: Uuid,
        user_b: Uuid,
    ) -> Result<bool, ApiError> {
        let count: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*) FROM player_blocks
            WHERE (blocker_id = $1 AND blocked_id = $2)
               OR (blocker_id = $2 AND blocked_id = $1)
            "#
        )
        .bind(user_a)
        .bind(user_b)
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        Ok(count > 0)
    }

    /// Get the block list for a user (players they have blocked).
    pub async fn get_block_list(
        &self,
        user_id: Uuid,
    ) -> Result<BlockListResponse, ApiError> {
        let entries = sqlx::query_as::<_, (Uuid, Uuid, chrono::DateTime<chrono::Utc>)>(
            r#"
            SELECT blocker_id, blocked_id, created_at
            FROM player_blocks
            WHERE blocker_id = $1
            ORDER BY created_at DESC
            "#
        )
        .bind(user_id)
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        let total_count = entries.len() as i32;
        let blocks = entries
            .into_iter()
            .map(|(blocker_id, blocked_id, created_at)| BlockEntry {
                blocker_id,
                blocked_id,
                created_at,
            })
            .collect();

        Ok(BlockListResponse { blocks, total_count })
    }

    // ── Community feed (#1528) ───────────────────────────────────────────────

    /// One page of the community feed, newest first, positioned by a keyset
    /// cursor.
    ///
    /// `viewer` only personalises `is_liked`; anonymous callers pass `None` and
    /// always get `is_liked: false`.
    pub async fn get_feed(
        &self,
        viewer: Option<Uuid>,
        cursor: Option<&FeedCursor>,
        limit: i64,
    ) -> Result<FeedPage, ApiError> {
        let limit = clamp_feed_limit(Some(limit));
        let sql = format!(
            "{FEED_SELECT}
             AND ($2::timestamptz IS NULL OR (p.created_at, p.id) < ($2::timestamptz, $3::uuid))
             ORDER BY p.created_at DESC, p.id DESC
             LIMIT $4"
        );

        let rows = sqlx::query(&sql)
            .bind(viewer)
            .bind(cursor.map(|c| c.created_at))
            .bind(cursor.map(|c| c.id))
            .bind(limit + 1)
            .fetch_all(&self.db_pool)
            .await
            .map_err(ApiError::DatabaseError)?;

        let posts = rows
            .iter()
            .map(feed_post_from_row)
            .collect::<Result<Vec<_>, _>>()?;

        Ok(build_feed_page(posts, limit, true))
    }

    /// One page of the community feed using `OFFSET`.
    ///
    /// Deprecated in favour of [`SocialService::get_feed`] (#1528); kept so
    /// clients on the old contract keep working while they migrate.
    pub async fn get_feed_offset(
        &self,
        viewer: Option<Uuid>,
        offset: i64,
        limit: i64,
    ) -> Result<FeedPage, ApiError> {
        let limit = clamp_feed_limit(Some(limit));
        let offset = offset.max(0);
        let sql = format!(
            "{FEED_SELECT}
             ORDER BY p.created_at DESC, p.id DESC
             LIMIT $2 OFFSET $3"
        );

        let rows = sqlx::query(&sql)
            .bind(viewer)
            .bind(limit + 1)
            .bind(offset)
            .fetch_all(&self.db_pool)
            .await
            .map_err(ApiError::DatabaseError)?;

        let posts = rows
            .iter()
            .map(feed_post_from_row)
            .collect::<Result<Vec<_>, _>>()?;

        Ok(build_feed_page(posts, limit, false))
    }
}

#[cfg(test)]
mod feed_tests {
    use super::*;

    /// Postgres stores `timestamptz` at microsecond resolution, so feed rows
    /// never carry nanoseconds; tests build their timestamps the same way.
    fn micros_now() -> DateTime<Utc> {
        DateTime::from_timestamp_micros(Utc::now().timestamp_micros()).expect("valid timestamp")
    }

    fn post(created_at: DateTime<Utc>, id: Uuid) -> CommunityPost {
        CommunityPost {
            id,
            author_id: Uuid::new_v4(),
            author_username: "player".to_string(),
            author_avatar: None,
            title: "title".to_string(),
            content: "content".to_string(),
            category: "general".to_string(),
            likes: 0,
            comments: 0,
            is_liked: false,
            created_at,
        }
    }

    #[test]
    fn cursor_round_trips_through_its_opaque_encoding() {
        let cursor = FeedCursor::new(micros_now(), Uuid::new_v4());

        let decoded = FeedCursor::decode(&cursor.encode()).unwrap();

        assert_eq!(decoded.created_at, cursor.created_at);
        assert_eq!(decoded.id, cursor.id);
    }

    #[test]
    fn cursor_preserves_microsecond_precision() {
        // Postgres timestamps are microsecond-precise; a cursor truncated to
        // milliseconds would re-read or skip the row it was built from.
        let created_at = DateTime::from_timestamp_micros(1_700_000_000_123_456).unwrap();
        let cursor = FeedCursor::new(created_at, Uuid::new_v4());

        assert_eq!(FeedCursor::decode(&cursor.encode()).unwrap().created_at, created_at);
    }

    #[test]
    fn malformed_cursors_are_rejected() {
        let id = Uuid::new_v4();
        let cases = [
            "".to_string(),
            "not-base64!!".to_string(),
            URL_SAFE_NO_PAD.encode("no-separator"),
            URL_SAFE_NO_PAD.encode(format!("not-a-number:{id}")),
            URL_SAFE_NO_PAD.encode("1700000000000000:not-a-uuid"),
            URL_SAFE_NO_PAD.encode("999999999999999999999:".to_string() + &id.to_string()),
        ];

        for raw in cases {
            assert!(
                FeedCursor::decode(&raw).is_err(),
                "cursor {raw:?} should have been rejected"
            );
        }
    }

    #[test]
    fn page_limits_are_clamped() {
        assert_eq!(clamp_feed_limit(None), DEFAULT_FEED_LIMIT);
        assert_eq!(clamp_feed_limit(Some(0)), 1);
        assert_eq!(clamp_feed_limit(Some(-5)), 1);
        assert_eq!(clamp_feed_limit(Some(10)), 10);
        assert_eq!(clamp_feed_limit(Some(MAX_FEED_LIMIT + 1)), MAX_FEED_LIMIT);
    }

    #[test]
    fn a_full_page_with_an_extra_row_yields_a_cursor() {
        let now = micros_now();
        let posts = vec![
            post(now, Uuid::new_v4()),
            post(now - chrono::Duration::seconds(1), Uuid::new_v4()),
            post(now - chrono::Duration::seconds(2), Uuid::new_v4()),
        ];

        let page = build_feed_page(posts, 2, true);

        assert_eq!(page.posts.len(), 2);
        assert!(page.has_more);
        // The cursor must point at the last row *returned*, not the probe row.
        let cursor = FeedCursor::decode(page.next_cursor.as_deref().unwrap()).unwrap();
        assert_eq!(cursor.created_at, page.posts[1].created_at);
        assert_eq!(cursor.id, page.posts[1].id);
    }

    #[test]
    fn a_short_page_has_no_cursor() {
        let page = build_feed_page(vec![post(Utc::now(), Uuid::new_v4())], 2, true);

        assert_eq!(page.posts.len(), 1);
        assert!(!page.has_more);
        assert!(page.next_cursor.is_none());
    }

    #[test]
    fn the_offset_endpoint_reports_more_without_a_cursor() {
        let now = micros_now();
        let posts = vec![
            post(now, Uuid::new_v4()),
            post(now - chrono::Duration::seconds(1), Uuid::new_v4()),
        ];

        let page = build_feed_page(posts, 1, false);

        assert_eq!(page.posts.len(), 1);
        assert!(page.has_more);
        assert!(page.next_cursor.is_none());
    }
}
