// EClaw Frontend: Signup Source Tracking
// Captures acquisition parameters for growth analytics

class SignupSourceTracker {
    constructor() {
        this.signupData = {
            signup_source: 'organic',
            referral_code: null,
            utm_source: null,
            utm_medium: null,
            utm_campaign: null,
            landing_page: window.location.href
        };

        this.init();
    }

    init() {
        this.parseUrlParameters();
        this.detectSignupSource();
        this.storeTrackingData();
    }

    parseUrlParameters() {
        const urlParams = new URLSearchParams(window.location.search);

        // UTM parameters
        this.signupData.utm_source = urlParams.get('utm_source');
        this.signupData.utm_medium = urlParams.get('utm_medium');
        this.signupData.utm_campaign = urlParams.get('utm_campaign');

        // Referral code
        this.signupData.referral_code = urlParams.get('ref') || urlParams.get('invite');
    }

    detectSignupSource() {
        const urlParams = new URLSearchParams(window.location.search);
        const currentUrl = window.location.href;
        const referrer = document.referrer;

        // Priority order for source detection

        // 1. Invite code (highest priority)
        if (this.signupData.referral_code) {
            this.signupData.signup_source = 'invite_code';
            return;
        }

        // 2. Bot Plaza CTA
        if (currentUrl.includes('?tab=register') ||
            referrer.includes('/portal/community.html')) {
            this.signupData.signup_source = 'bot_plaza';
            return;
        }

        // 3. Arena leaderboard
        if (referrer.includes('/arena') ||
            urlParams.get('from') === 'arena') {
            this.signupData.signup_source = 'arena_leaderboard';
            return;
        }

        // 4. UTM-based detection
        if (this.signupData.utm_source) {
            if (this.signupData.utm_source === 'twitter' ||
                this.signupData.utm_source === 'facebook' ||
                this.signupData.utm_source === 'linkedin') {
                this.signupData.signup_source = 'social_media';
                return;
            }

            if (this.signupData.utm_source === 'google' ||
                this.signupData.utm_source === 'bing') {
                this.signupData.signup_source = 'search_engine';
                return;
            }
        }

        // 5. Referrer-based detection
        if (referrer) {
            const referrerDomain = new URL(referrer).hostname;

            // Social media referrers
            if (['twitter.com', 'x.com', 'facebook.com', 'linkedin.com',
                 'reddit.com', 'discord.com'].includes(referrerDomain)) {
                this.signupData.signup_source = 'social_media';
                return;
            }

            // Search engines
            if (['google.com', 'bing.com', 'duckduckgo.com',
                 'baidu.com', 'yahoo.com'].includes(referrerDomain)) {
                this.signupData.signup_source = 'search_engine';
                return;
            }

            // External referral
            if (!referrerDomain.includes('eclawbot.com')) {
                this.signupData.signup_source = 'referral';
                return;
            }
        }

        // 6. Direct access (no referrer)
        if (!referrer) {
            this.signupData.signup_source = 'direct_link';
            return;
        }

        // Default: organic
        this.signupData.signup_source = 'organic';
    }

    storeTrackingData() {
        // Store in sessionStorage for registration form
        sessionStorage.setItem('eclaw_signup_tracking', JSON.stringify(this.signupData));

        // Store persistent cookie for analytics (30 days)
        const cookieData = JSON.stringify({
            source: this.signupData.signup_source,
            timestamp: Date.now()
        });

        document.cookie = `eclaw_acquisition=${encodeURIComponent(cookieData)}; max-age=2592000; path=/`;
    }

    getTrackingData() {
        return this.signupData;
    }

    // Enhanced registration form submission
    enhanceRegistrationForm() {
        const registrationForms = document.querySelectorAll('form[action*="register"]');

        registrationForms.forEach(form => {
            form.addEventListener('submit', (e) => {
                const trackingData = this.getTrackingData();

                // Add hidden fields to form
                Object.keys(trackingData).forEach(key => {
                    if (trackingData[key]) {
                        const input = document.createElement('input');
                        input.type = 'hidden';
                        input.name = key;
                        input.value = trackingData[key];
                        form.appendChild(input);
                    }
                });
            });
        });
    }
}

// Analytics Dashboard Integration
class GrowthAnalytics {
    constructor() {
        this.apiBase = '/api/analytics';
    }

    async getAcquisitionData(timeframe = '7d') {
        try {
            const response = await fetch(`${this.apiBase}/acquisition?timeframe=${timeframe}`);
            const data = await response.json();

            if (data.success) {
                return data;
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            console.error('Failed to fetch acquisition data:', error);
            return null;
        }
    }

    async renderAcquisitionChart(containerId, timeframe = '7d') {
        const data = await this.getAcquisitionData(timeframe);
        if (!data) return;

        const container = document.getElementById(containerId);
        if (!container) return;

        // Group by source
        const sourceData = {};
        data.acquisitionData.forEach(row => {
            if (!sourceData[row.signup_source]) {
                sourceData[row.signup_source] = 0;
            }
            sourceData[row.signup_source] += parseInt(row.user_count);
        });

        // Render simple chart
        container.innerHTML = `
            <div class="growth-metrics">
                <h3>User Acquisition (${timeframe})</h3>
                <div class="viral-coefficient">
                    <strong>Viral Coefficient (k-value): ${data.viralCoefficient.toFixed(3)}</strong>
                </div>
                <div class="source-breakdown">
                    ${Object.entries(sourceData).map(([source, count]) => `
                        <div class="source-item">
                            <span class="source-name">${source}</span>
                            <span class="source-count">${count} users</span>
                            <span class="source-percent">${((count/data.totalUsers)*100).toFixed(1)}%</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
}

// Auto-initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    const tracker = new SignupSourceTracker();
    tracker.enhanceRegistrationForm();

    // Initialize analytics dashboard if element exists
    if (document.getElementById('growth-analytics')) {
        const analytics = new GrowthAnalytics();
        analytics.renderAcquisitionChart('growth-analytics');
    }
});

// Export for use in other modules
window.EClawGrowthTracking = {
    SignupSourceTracker,
    GrowthAnalytics
};