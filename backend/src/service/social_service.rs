use crate::api_error::ApiError;
use crate::models::{
    Friend, FriendRequest, Message, Conversation, Party, PartyMember, CommunityPost,
    OnlineStatus, SocialNotification, FriendsListResponse,
};
use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

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
            leader_username,
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
}
