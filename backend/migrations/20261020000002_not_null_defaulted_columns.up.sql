-- Columns that have a default and are always treated as present by the
-- application models are made NOT NULL. Existing NULLs are backfilled with
-- the column default first so the constraint can be applied safely.

UPDATE achievements SET is_active = DEFAULT WHERE is_active IS NULL;
ALTER TABLE achievements ALTER COLUMN is_active SET NOT NULL;

UPDATE api_keys SET metadata = DEFAULT WHERE metadata IS NULL;
ALTER TABLE api_keys ALTER COLUMN metadata SET NOT NULL;

UPDATE community_posts SET comments = DEFAULT WHERE comments IS NULL;
ALTER TABLE community_posts ALTER COLUMN comments SET NOT NULL;
UPDATE community_posts SET is_active = DEFAULT WHERE is_active IS NULL;
ALTER TABLE community_posts ALTER COLUMN is_active SET NOT NULL;
UPDATE community_posts SET likes = DEFAULT WHERE likes IS NULL;
ALTER TABLE community_posts ALTER COLUMN likes SET NOT NULL;

UPDATE leaderboards SET losses = DEFAULT WHERE losses IS NULL;
ALTER TABLE leaderboards ALTER COLUMN losses SET NOT NULL;
UPDATE leaderboards SET matches_played = DEFAULT WHERE matches_played IS NULL;
ALTER TABLE leaderboards ALTER COLUMN matches_played SET NOT NULL;
UPDATE leaderboards SET win_rate = DEFAULT WHERE win_rate IS NULL;
ALTER TABLE leaderboards ALTER COLUMN win_rate SET NOT NULL;
UPDATE leaderboards SET wins = DEFAULT WHERE wins IS NULL;
ALTER TABLE leaderboards ALTER COLUMN wins SET NOT NULL;

UPDATE match_authority SET metadata = DEFAULT WHERE metadata IS NULL;
ALTER TABLE match_authority ALTER COLUMN metadata SET NOT NULL;

UPDATE match_chain_sync SET metadata = DEFAULT WHERE metadata IS NULL;
ALTER TABLE match_chain_sync ALTER COLUMN metadata SET NOT NULL;
UPDATE match_chain_sync SET retry_count = DEFAULT WHERE retry_count IS NULL;
ALTER TABLE match_chain_sync ALTER COLUMN retry_count SET NOT NULL;

UPDATE match_disputes SET status = DEFAULT WHERE status IS NULL;
ALTER TABLE match_disputes ALTER COLUMN status SET NOT NULL;

UPDATE match_reconciliation_log SET metadata = DEFAULT WHERE metadata IS NULL;
ALTER TABLE match_reconciliation_log ALTER COLUMN metadata SET NOT NULL;

UPDATE match_scores SET verified = DEFAULT WHERE verified IS NULL;
ALTER TABLE match_scores ALTER COLUMN verified SET NOT NULL;

UPDATE match_transitions SET metadata = DEFAULT WHERE metadata IS NULL;
ALTER TABLE match_transitions ALTER COLUMN metadata SET NOT NULL;

UPDATE matches SET match_type = DEFAULT WHERE match_type IS NULL;
ALTER TABLE matches ALTER COLUMN match_type SET NOT NULL;
UPDATE matches SET status = DEFAULT WHERE status IS NULL;
ALTER TABLE matches ALTER COLUMN status SET NOT NULL;

UPDATE matchmaking_queue SET status = DEFAULT WHERE status IS NULL;
ALTER TABLE matchmaking_queue ALTER COLUMN status SET NOT NULL;

UPDATE messages SET is_read = DEFAULT WHERE is_read IS NULL;
ALTER TABLE messages ALTER COLUMN is_read SET NOT NULL;

UPDATE parties SET is_active = DEFAULT WHERE is_active IS NULL;
ALTER TABLE parties ALTER COLUMN is_active SET NOT NULL;

UPDATE player_achievements SET is_unlocked = DEFAULT WHERE is_unlocked IS NULL;
ALTER TABLE player_achievements ALTER COLUMN is_unlocked SET NOT NULL;
UPDATE player_achievements SET max_progress = DEFAULT WHERE max_progress IS NULL;
ALTER TABLE player_achievements ALTER COLUMN max_progress SET NOT NULL;
UPDATE player_achievements SET progress = DEFAULT WHERE progress IS NULL;
ALTER TABLE player_achievements ALTER COLUMN progress SET NOT NULL;

UPDATE prize_pools SET currency = DEFAULT WHERE currency IS NULL;
ALTER TABLE prize_pools ALTER COLUMN currency SET NOT NULL;
UPDATE prize_pools SET distribution_percentages = DEFAULT WHERE distribution_percentages IS NULL;
ALTER TABLE prize_pools ALTER COLUMN distribution_percentages SET NOT NULL;
UPDATE prize_pools SET total_amount = DEFAULT WHERE total_amount IS NULL;
ALTER TABLE prize_pools ALTER COLUMN total_amount SET NOT NULL;

UPDATE social_notifications SET is_read = DEFAULT WHERE is_read IS NULL;
ALTER TABLE social_notifications ALTER COLUMN is_read SET NOT NULL;

UPDATE soroban_contracts SET is_active = DEFAULT WHERE is_active IS NULL;
ALTER TABLE soroban_contracts ALTER COLUMN is_active SET NOT NULL;

UPDATE stellar_accounts SET account_type = DEFAULT WHERE account_type IS NULL;
ALTER TABLE stellar_accounts ALTER COLUMN account_type SET NOT NULL;
UPDATE stellar_accounts SET balance_xlm = DEFAULT WHERE balance_xlm IS NULL;
ALTER TABLE stellar_accounts ALTER COLUMN balance_xlm SET NOT NULL;
UPDATE stellar_accounts SET is_active = DEFAULT WHERE is_active IS NULL;
ALTER TABLE stellar_accounts ALTER COLUMN is_active SET NOT NULL;
UPDATE stellar_accounts SET is_funded = DEFAULT WHERE is_funded IS NULL;
ALTER TABLE stellar_accounts ALTER COLUMN is_funded SET NOT NULL;

UPDATE stellar_transactions SET asset_code = DEFAULT WHERE asset_code IS NULL;
ALTER TABLE stellar_transactions ALTER COLUMN asset_code SET NOT NULL;
UPDATE stellar_transactions SET status = DEFAULT WHERE status IS NULL;
ALTER TABLE stellar_transactions ALTER COLUMN status SET NOT NULL;

UPDATE tournament_matches SET status = DEFAULT WHERE status IS NULL;
ALTER TABLE tournament_matches ALTER COLUMN status SET NOT NULL;

UPDATE tournament_participants SET entry_fee_paid = DEFAULT WHERE entry_fee_paid IS NULL;
ALTER TABLE tournament_participants ALTER COLUMN entry_fee_paid SET NOT NULL;
UPDATE tournament_participants SET status = DEFAULT WHERE status IS NULL;
ALTER TABLE tournament_participants ALTER COLUMN status SET NOT NULL;

UPDATE tournament_rounds SET status = DEFAULT WHERE status IS NULL;
ALTER TABLE tournament_rounds ALTER COLUMN status SET NOT NULL;

UPDATE tournaments SET bracket_type = DEFAULT WHERE bracket_type IS NULL;
ALTER TABLE tournaments ALTER COLUMN bracket_type SET NOT NULL;
UPDATE tournaments SET entry_fee = DEFAULT WHERE entry_fee IS NULL;
ALTER TABLE tournaments ALTER COLUMN entry_fee SET NOT NULL;
UPDATE tournaments SET entry_fee_currency = DEFAULT WHERE entry_fee_currency IS NULL;
ALTER TABLE tournaments ALTER COLUMN entry_fee_currency SET NOT NULL;
UPDATE tournaments SET prize_pool = DEFAULT WHERE prize_pool IS NULL;
ALTER TABLE tournaments ALTER COLUMN prize_pool SET NOT NULL;
UPDATE tournaments SET prize_pool_currency = DEFAULT WHERE prize_pool_currency IS NULL;
ALTER TABLE tournaments ALTER COLUMN prize_pool_currency SET NOT NULL;
UPDATE tournaments SET status = DEFAULT WHERE status IS NULL;
ALTER TABLE tournaments ALTER COLUMN status SET NOT NULL;

UPDATE transaction_monitor SET created_at = DEFAULT WHERE created_at IS NULL;
ALTER TABLE transaction_monitor ALTER COLUMN created_at SET NOT NULL;
UPDATE transaction_monitor SET metadata = DEFAULT WHERE metadata IS NULL;
ALTER TABLE transaction_monitor ALTER COLUMN metadata SET NOT NULL;

UPDATE transactions SET currency = DEFAULT WHERE currency IS NULL;
ALTER TABLE transactions ALTER COLUMN currency SET NOT NULL;
UPDATE transactions SET status = DEFAULT WHERE status IS NULL;
ALTER TABLE transactions ALTER COLUMN status SET NOT NULL;

UPDATE user_elo SET current_rating = DEFAULT WHERE current_rating IS NULL;
ALTER TABLE user_elo ALTER COLUMN current_rating SET NOT NULL;
UPDATE user_elo SET draws = DEFAULT WHERE draws IS NULL;
ALTER TABLE user_elo ALTER COLUMN draws SET NOT NULL;
UPDATE user_elo SET games_played = DEFAULT WHERE games_played IS NULL;
ALTER TABLE user_elo ALTER COLUMN games_played SET NOT NULL;
UPDATE user_elo SET loss_streak = DEFAULT WHERE loss_streak IS NULL;
ALTER TABLE user_elo ALTER COLUMN loss_streak SET NOT NULL;
UPDATE user_elo SET losses = DEFAULT WHERE losses IS NULL;
ALTER TABLE user_elo ALTER COLUMN losses SET NOT NULL;
UPDATE user_elo SET peak_rating = DEFAULT WHERE peak_rating IS NULL;
ALTER TABLE user_elo ALTER COLUMN peak_rating SET NOT NULL;
UPDATE user_elo SET win_streak = DEFAULT WHERE win_streak IS NULL;
ALTER TABLE user_elo ALTER COLUMN win_streak SET NOT NULL;
UPDATE user_elo SET wins = DEFAULT WHERE wins IS NULL;
ALTER TABLE user_elo ALTER COLUMN wins SET NOT NULL;

UPDATE users SET anticheat_flags_count = DEFAULT WHERE anticheat_flags_count IS NULL;
ALTER TABLE users ALTER COLUMN anticheat_flags_count SET NOT NULL;
UPDATE users SET country_code = DEFAULT WHERE country_code IS NULL;
ALTER TABLE users ALTER COLUMN country_code SET NOT NULL;
UPDATE users SET fair_play_score = DEFAULT WHERE fair_play_score IS NULL;
ALTER TABLE users ALTER COLUMN fair_play_score SET NOT NULL;
UPDATE users SET is_active = DEFAULT WHERE is_active IS NULL;
ALTER TABLE users ALTER COLUMN is_active SET NOT NULL;
UPDATE users SET is_bad_actor = DEFAULT WHERE is_bad_actor IS NULL;
ALTER TABLE users ALTER COLUMN is_bad_actor SET NOT NULL;
UPDATE users SET is_verified = DEFAULT WHERE is_verified IS NULL;
ALTER TABLE users ALTER COLUMN is_verified SET NOT NULL;
UPDATE users SET role = DEFAULT WHERE role IS NULL;
ALTER TABLE users ALTER COLUMN role SET NOT NULL;
UPDATE users SET skill_score = DEFAULT WHERE skill_score IS NULL;
ALTER TABLE users ALTER COLUMN skill_score SET NOT NULL;

UPDATE wallets SET balance = DEFAULT WHERE balance IS NULL;
ALTER TABLE wallets ALTER COLUMN balance SET NOT NULL;
UPDATE wallets SET balance_arenax_tokens = DEFAULT WHERE balance_arenax_tokens IS NULL;
ALTER TABLE wallets ALTER COLUMN balance_arenax_tokens SET NOT NULL;
UPDATE wallets SET balance_ngn = DEFAULT WHERE balance_ngn IS NULL;
ALTER TABLE wallets ALTER COLUMN balance_ngn SET NOT NULL;
UPDATE wallets SET balance_xlm = DEFAULT WHERE balance_xlm IS NULL;
ALTER TABLE wallets ALTER COLUMN balance_xlm SET NOT NULL;
UPDATE wallets SET currency = DEFAULT WHERE currency IS NULL;
ALTER TABLE wallets ALTER COLUMN currency SET NOT NULL;
UPDATE wallets SET escrow_balance = DEFAULT WHERE escrow_balance IS NULL;
ALTER TABLE wallets ALTER COLUMN escrow_balance SET NOT NULL;
UPDATE wallets SET is_active = DEFAULT WHERE is_active IS NULL;
ALTER TABLE wallets ALTER COLUMN is_active SET NOT NULL;
