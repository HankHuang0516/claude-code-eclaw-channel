// EClaw Growth Tracking API Implementation
// Captures signup_source for user acquisition analytics

// Updated user registration endpoint
app.post('/api/auth/register', async (req, res) => {
    try {
        const {
            username,
            email,
            password,
            // Growth tracking parameters
            signup_source = 'organic',
            referral_code,
            utm_source,
            utm_medium,
            utm_campaign,
            landing_page
        } = req.body;

        // Validate signup_source
        const validSources = [
            'organic',
            'invite_code',
            'referral',
            'bot_plaza',
            'arena_leaderboard',
            'social_media',
            'search_engine',
            'direct_link'
        ];

        if (!validSources.includes(signup_source)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid signup source'
            });
        }

        // Create user with signup_source
        const user = await db.users.create({
            username,
            email,
            password_hash: await bcrypt.hash(password, 10),
            signup_source,
            created_at: new Date()
        });

        // Track detailed acquisition data
        await db.user_acquisition_tracking.create({
            user_id: user.id,
            signup_source,
            referral_code,
            utm_source,
            utm_medium,
            utm_campaign,
            landing_page,
            ip_address: req.ip,
            user_agent: req.get('User-Agent'),
            created_at: new Date()
        });

        // Process viral growth mechanics
        if (signup_source === 'invite_code' && referral_code) {
            await processInviteReward(user.id, referral_code);
        }

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                signup_source: user.signup_source
            }
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            error: 'Registration failed'
        });
    }
});

// Growth analytics endpoint
app.get('/api/analytics/acquisition', async (req, res) => {
    try {
        const { timeframe = '7d' } = req.query;

        // Calculate date range
        const endDate = new Date();
        const startDate = new Date();
        if (timeframe === '24h') startDate.setHours(startDate.getHours() - 24);
        else if (timeframe === '7d') startDate.setDate(startDate.getDate() - 7);
        else if (timeframe === '30d') startDate.setDate(startDate.getDate() - 30);

        // Query acquisition data
        const acquisitionData = await db.query(`
            SELECT
                signup_source,
                COUNT(*) as user_count,
                DATE(created_at) as date
            FROM users
            WHERE created_at >= $1 AND created_at <= $2
            GROUP BY signup_source, DATE(created_at)
            ORDER BY date DESC, user_count DESC
        `, [startDate, endDate]);

        // Calculate viral coefficient (k-value)
        const inviteData = await db.query(`
            SELECT COUNT(*) as invited_users
            FROM users
            WHERE signup_source = 'invite_code'
            AND created_at >= $1
        `, [startDate]);

        const totalUsers = await db.query(`
            SELECT COUNT(*) as total
            FROM users
            WHERE created_at >= $1
        `, [startDate]);

        const viralCoefficient = totalUsers.rows[0]?.total > 0
            ? inviteData.rows[0]?.invited_users / totalUsers.rows[0]?.total
            : 0;

        res.json({
            success: true,
            timeframe,
            acquisitionData: acquisitionData.rows,
            viralCoefficient,
            totalUsers: totalUsers.rows[0]?.total || 0
        });

    } catch (error) {
        console.error('Analytics error:', error);
        res.status(500).json({
            success: false,
            error: 'Analytics query failed'
        });
    }
});

// Process invite rewards for viral growth
async function processInviteReward(userId, referralCode) {
    try {
        // Find the referrer
        const referrer = await db.users.findOne({
            where: { invite_code: referralCode }
        });

        if (!referrer) return;

        // Award coins to both users (viral incentive)
        await db.wallets.increment('balance', {
            by: 500, // New user bonus
            where: { user_id: userId }
        });

        await db.wallets.increment('balance', {
            by: 100, // Referrer bonus
            where: { user_id: referrer.id }
        });

        // Track viral conversion
        await db.invite_conversions.create({
            referrer_id: referrer.id,
            referred_id: userId,
            referral_code,
            reward_amount: 600, // 500 + 100
            created_at: new Date()
        });

    } catch (error) {
        console.error('Invite reward error:', error);
    }
}

module.exports = { processInviteReward };