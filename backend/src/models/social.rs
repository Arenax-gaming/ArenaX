use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Friend {
    pub id: Uuid,
    pub username: String,
    pub avatar_url: Option<String>,
    pub is_online: bool,
    pub last_seen: Option<DateTime<Utc>>,
    pub added_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendRequest {
    pub id: Uuid,
    pub from_user_id: Uuid,
    pub from_username: String,
    pub from_avatar: Option<String>,
    pub to_user_id: Uuid,
    pub status: String, // pending, accepted, rejected
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: Uuid,
    pub from_user_id: Uuid,
    pub from_username: String,
    pub to_user_id: Uuid,
    pub content: String,
    pub is_read: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: Uuid,
    pub participant_id: Uuid,
    pub participant_username: String,
    pub participant_avatar: Option<String>,
    pub last_message: Option<String>,
    pub last_message_at: Option<DateTime<Utc>>,
    pub unread_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Party {
    pub id: Uuid,
    pub leader_id: Uuid,
    pub leader_username: String,
    pub name: String,
    pub description: Option<String>,
    pub max_members: i32,
    pub current_members: i32,
    pub members: Vec<PartyMember>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartyMember {
    pub user_id: Uuid,
    pub username: String,
    pub avatar_url: Option<String>,
    pub role: String, // leader, member
    pub joined_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommunityPost {
    pub id: Uuid,
    pub author_id: Uuid,
    pub author_username: String,
    pub author_avatar: Option<String>,
    pub title: String,
    pub content: String,
    pub category: String,
    pub likes: i32,
    pub comments: i32,
    pub is_liked: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnlineStatus {
    pub user_id: Uuid,
    pub username: String,
    pub is_online: bool,
    pub last_seen: Option<DateTime<Utc>>,
    pub status_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialNotification {
    pub id: Uuid,
    pub user_id: Uuid,
    pub notification_type: String, // friend_request, message, party_invite, post_like, post_comment
    pub from_user_id: Option<Uuid>,
    pub from_username: Option<String>,
    pub content: String,
    pub is_read: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddFriendRequest {
    pub friend_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendMessageRequest {
    pub to_user_id: Uuid,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePartyRequest {
    pub name: String,
    pub description: Option<String>,
    pub max_members: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePostRequest {
    pub title: String,
    pub content: String,
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendsListResponse {
    pub friends: Vec<Friend>,
    pub total_count: i32,
    pub online_count: i32,
}
