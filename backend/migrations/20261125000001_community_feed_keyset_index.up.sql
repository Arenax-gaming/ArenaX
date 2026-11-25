-- Cursor (keyset) pagination for the community feed (#1528).
--
-- The feed pages by `(created_at, id)` descending, so the index has to carry
-- both columns in that order. `idx_community_posts_created` alone cannot break
-- ties between posts that share a timestamp, which would let a page boundary
-- repeat or skip a row.
CREATE INDEX IF NOT EXISTS idx_community_posts_feed_keyset
    ON community_posts (created_at DESC, id DESC)
    WHERE is_active = TRUE;

-- The feed's `is_liked` flag is resolved per viewer through post_likes.
CREATE INDEX IF NOT EXISTS idx_post_likes_user_post
    ON post_likes (user_id, post_id);
