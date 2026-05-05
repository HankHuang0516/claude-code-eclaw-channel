-- EClaw Growth Tracking: signup_source Field Implementation
-- Implements user acquisition channel tracking for viral growth analysis

-- 1. Add signup_source field to user registration table
ALTER TABLE users ADD COLUMN signup_source VARCHAR(50) DEFAULT 'organic';

-- 2. Add index for analytics queries
CREATE INDEX idx_users_signup_source ON users(signup_source);

-- 3. Create growth analytics tracking table
CREATE TABLE user_acquisition_tracking (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    signup_source VARCHAR(50) NOT NULL,
    referral_code VARCHAR(20),
    utm_source VARCHAR(50),
    utm_medium VARCHAR(50),
    utm_campaign VARCHAR(50),
    landing_page VARCHAR(200),
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Create index for analytics queries
CREATE INDEX idx_acquisition_tracking_source ON user_acquisition_tracking(signup_source);
CREATE INDEX idx_acquisition_tracking_created ON user_acquisition_tracking(created_at);

-- 5. Update existing users with default source
UPDATE users SET signup_source = 'legacy' WHERE signup_source IS NULL;

-- 6. Add constraint to ensure valid sources
ALTER TABLE users ADD CONSTRAINT check_valid_signup_source
    CHECK (signup_source IN (
        'organic',
        'invite_code',
        'referral',
        'bot_plaza',
        'arena_leaderboard',
        'social_media',
        'search_engine',
        'direct_link',
        'legacy'
    ));