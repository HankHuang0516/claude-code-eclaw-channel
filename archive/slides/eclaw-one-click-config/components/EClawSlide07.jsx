import React, { useEffect, useState } from 'react';
import styled, { keyframes, css } from 'styled-components';

// Animations
const slideInDown = keyframes`
  from {
    opacity: 0;
    transform: translateY(-50px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const slideInUp = keyframes`
  from {
    opacity: 0;
    transform: translateY(50px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const slideInLeft = keyframes`
  from {
    opacity: 0;
    transform: translateX(-50px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
`;

const slideInRight = keyframes`
  from {
    opacity: 0;
    transform: translateX(50px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
`;

const pulse = keyframes`
  0%, 100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.05);
  }
`;

const premiumGlow = keyframes`
  0%, 100% {
    box-shadow: 0 8px 32px rgba(212, 175, 55, 0.15);
  }
  50% {
    box-shadow: 0 8px 40px rgba(212, 175, 55, 0.25);
  }
`;

// Styled Components
const SlideContainer = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  padding: 64px;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  position: relative;
  z-index: 1;
  background: linear-gradient(135deg, #1A252F 0%, #2C3E50 100%);

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-image:
      radial-gradient(circle at 25% 25%, rgba(212, 175, 55, 0.05) 0%, transparent 50%),
      radial-gradient(circle at 75% 75%, rgba(52, 73, 94, 0.05) 0%, transparent 50%);
    pointer-events: none;
    z-index: -1;
  }

  @media (max-width: 768px) {
    padding: 24px;
  }
`;

const HeaderSection = styled.div`
  text-align: center;
  margin-bottom: 60px;
  animation: ${slideInDown} 0.8s ease-out;
`;

const EmojiIcon = styled.span`
  font-size: 64px;
  margin-bottom: 24px;
  display: block;
  animation: ${pulse} 2s ease-in-out infinite;

  @media (max-width: 375px) {
    font-size: 48px;
  }
`;

const Headline = styled.h1`
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 700;
  font-size: 48px;
  color: #FFFFFF;
  line-height: 1.2;
  margin-bottom: 16px;
  text-align: center;

  @media (max-width: 768px) {
    font-size: 32px;
  }

  @media (max-width: 375px) {
    font-size: 28px;
  }
`;

const Subline = styled.p`
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 400;
  font-size: 20px;
  color: #D4AF37;
  margin-bottom: 40px;

  @media (max-width: 768px) {
    font-size: 16px;
  }
`;

const EnterpriseContainer = styled.div`
  width: 100%;
  max-width: 1000px;
  margin-bottom: 40px;
  animation: ${slideInUp} 1s ease-out 0.3s both;
`;

const TierShowcase = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 32px;
  margin-bottom: 60px;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
    gap: 24px;
  }
`;

const TierCard = styled.div`
  background: #FFFFFF;
  border-radius: 24px;
  padding: 40px 32px;
  text-align: center;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  border: 2px solid #E5E7EB;
  transition: all 0.4s ease;
  position: relative;
  overflow: hidden;

  &::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 4px;
    transform: scaleX(0);
    transition: transform 0.4s ease;
  }

  &:nth-child(1)::after {
    background: linear-gradient(135deg, #2E86C1 0%, #3498DB 100%);
  }

  &:nth-child(2)::after {
    background: linear-gradient(135deg, #D4AF37 0%, #B8860B 100%);
  }

  &:nth-child(3)::after {
    background: linear-gradient(135deg, #34495E 0%, #2C3E50 100%);
  }

  &:hover::after {
    transform: scaleX(1);
  }

  &:hover:not(.premium) {
    transform: translateY(-8px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  }

  ${props => props.premium && css`
    background: linear-gradient(135deg, #D4AF37 0%, #B8860B 100%);
    color: #FFFFFF;
    border-color: #D4AF37;
    box-shadow: 0 8px 32px rgba(212, 175, 55, 0.15);
    transform: scale(1.05);
    animation: ${slideInUp} 0.8s ease-out 1.2s both, ${premiumGlow} 3s ease-in-out 2s infinite;

    &::before {
      content: '⭐ 推薦方案';
      position: absolute;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(255, 255, 255, 0.2);
      color: #FFFFFF;
      padding: 6px 16px;
      border-radius: 20px;
      font-family: 'Inter', sans-serif;
      font-weight: 600;
      font-size: 11px;
    }

    @media (max-width: 768px) {
      transform: none;
    }
  `}

  ${props => props.index === 0 && css`
    animation: ${slideInLeft} 0.8s ease-out 1s both;
  `}

  ${props => props.index === 2 && css`
    animation: ${slideInRight} 0.8s ease-out 1.4s both;
  `}

  @media (max-width: 768px) {
    padding: 32px 24px;
  }
`;

const TierIcon = styled.span`
  font-size: 40px;
  margin-bottom: 20px;
  display: block;

  @media (max-width: 375px) {
    font-size: 32px;
  }
`;

const TierName = styled.h3`
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 700;
  font-size: 24px;
  color: #2C3E50;
  margin-bottom: 12px;

  ${props => props.premium && css`
    color: #FFFFFF;
  `}
`;

const TierPrice = styled.div`
  font-family: 'Inter', sans-serif;
  font-weight: 800;
  font-size: 36px;
  margin-bottom: 8px;
  color: #2E86C1;

  ${props => props.premium && css`
    color: #FFFFFF;
  `}

  @media (max-width: 375px) {
    font-size: 28px;
  }
`;

const TierPeriod = styled.div`
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  font-size: 14px;
  color: #7F8C8D;
  margin-bottom: 24px;

  ${props => props.premium && css`
    color: rgba(255, 255, 255, 0.8);
  `}
`;

const FeatureList = styled.div`
  text-align: left;
  margin-bottom: 32px;
`;

const FeatureItem = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 400;
  font-size: 14px;
  color: #34495E;

  ${props => props.premium && css`
    color: #FFFFFF;
  `}
`;

const FeatureIcon = styled.span`
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #27AE60;
  color: #FFFFFF;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  flex-shrink: 0;

  ${props => props.premium && css`
    background: rgba(255, 255, 255, 0.3);
  `}
`;

const TierButton = styled.a`
  width: 100%;
  padding: 14px 24px;
  background: linear-gradient(135deg, #2E86C1 0%, #3498DB 100%);
  color: #FFFFFF;
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: 14px;
  text-decoration: none;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.3s ease;
  display: inline-block;
  text-align: center;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 16px rgba(46, 134, 193, 0.3);
  }

  ${props => props.premium && css`
    background: rgba(255, 255, 255, 0.2);
    border: 2px solid rgba(255, 255, 255, 0.3);

    &:hover {
      background: rgba(255, 255, 255, 0.3);
      box-shadow: 0 4px 16px rgba(255, 255, 255, 0.2);
    }
  `}
`;

const EnterpriseFeatures = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 32px;
  margin-bottom: 40px;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
    gap: 24px;
  }
`;

const FeatureCategory = styled.div`
  background: #FFFFFF;
  border-radius: 20px;
  padding: 32px 28px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  border: 2px solid #E5E7EB;
  transition: all 0.4s ease;

  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
    border-color: #D4AF37;
  }

  ${props => props.index % 2 === 0 ? css`
    animation: ${slideInLeft} 0.8s ease-out ${2 + props.index * 0.2}s both;
  ` : css`
    animation: ${slideInRight} 0.8s ease-out ${2 + props.index * 0.2}s both;
  `}

  @media (max-width: 768px) {
    padding: 24px 20px;
  }
`;

const FeatureHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
`;

const FeatureEmoji = styled.span`
  font-size: 32px;

  @media (max-width: 375px) {
    font-size: 24px;
  }
`;

const FeatureTitle = styled.h4`
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 600;
  font-size: 18px;
  color: #2C3E50;
`;

const FeatureDescription = styled.p`
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 400;
  font-size: 14px;
  color: #7F8C8D;
  line-height: 1.6;
  margin-bottom: 16px;
`;

const FeatureHighlights = styled.ul`
  list-style: none;
  padding: 0;
  margin: 0;
`;

const FeatureHighlight = styled.li`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 400;
  font-size: 13px;
  color: #34495E;

  &::before {
    content: '•';
    color: #D4AF37;
    font-weight: 700;
  }
`;

const SecurityBanner = styled.div`
  background: linear-gradient(135deg, #34495E 0%, #2C3E50 100%);
  color: #FFFFFF;
  padding: 32px 40px;
  border-radius: 20px;
  text-align: center;
  margin-bottom: 40px;
  animation: ${slideInUp} 1s ease-out 2.8s both;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="shield" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="10" cy="10" r="1" fill="rgba(212,175,55,0.1)"/></pattern></defs><rect width="100" height="100" fill="url(%23shield)"/></svg>');
    pointer-events: none;
  }

  @media (max-width: 768px) {
    padding: 24px 20px;
  }
`;

const SecurityContent = styled.div`
  position: relative;
  z-index: 2;
`;

const SecurityTitle = styled.h3`
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 700;
  font-size: 24px;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;

  @media (max-width: 768px) {
    font-size: 20px;
  }
`;

const SecurityDescription = styled.p`
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 400;
  font-size: 16px;
  opacity: 0.9;
  line-height: 1.6;
`;

const CtaSection = styled.div`
  text-align: center;
  animation: ${slideInUp} 1s ease-out 3.2s both;
`;

const CtaButton = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 18px 36px;
  background: linear-gradient(135deg, #D4AF37 0%, #B8860B 100%);
  color: #FFFFFF;
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  font-size: 16px;
  text-decoration: none;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(212, 175, 55, 0.15);
  transition: all 0.3s ease;
  text-transform: none;
  letter-spacing: 0.5px;

  &:hover {
    transform: scale(1.02);
    box-shadow: 0 8px 32px rgba(212, 175, 55, 0.25);
  }

  @media (max-width: 768px) {
    padding: 16px 32px;
    font-size: 14px;
  }
`;

// Component
const EClawSlide07 = () => {
  const [tiers] = useState([
    {
      icon: '🚀',
      name: '專業版',
      price: '$299',
      period: '每月 / 團隊',
      features: [
        '最多50個AI機器人',
        '團隊協作工具',
        '基礎API整合',
        '電子郵件支援'
      ],
      buttonText: '開始使用',
      premium: false
    },
    {
      icon: '⭐',
      name: '企業版',
      price: '$999',
      period: '每月 / 組織',
      features: [
        '無限AI機器人',
        '高級安全控制',
        '客製化整合',
        '24/7專屬支援'
      ],
      buttonText: '聯繫業務',
      premium: true
    },
    {
      icon: '🏢',
      name: '私有部署',
      price: '客製',
      period: '報價 / 專案',
      features: [
        '完全私有化部署',
        '企業級SLA',
        '專屬架構設計',
        '現場技術支援'
      ],
      buttonText: '申請評估',
      premium: false
    }
  ]);

  const [features] = useState([
    {
      emoji: '🔒',
      title: '企業級安全',
      description: '符合國際安全標準，保護您的企業資料和商業機密',
      highlights: [
        'ISO 27001 認證',
        '端到端加密',
        '存取控制管理',
        '合規性審計'
      ]
    },
    {
      emoji: '📈',
      title: '無限擴展',
      description: '彈性架構設計，隨著業務成長自動擴展服務容量',
      highlights: [
        '自動水平擴展',
        '負載平衡機制',
        '高可用性保證',
        '災難恢復方案'
      ]
    },
    {
      emoji: '🔧',
      title: '客製化服務',
      description: '專業團隊為您量身打造符合業務需求的AI解決方案',
      highlights: [
        '專屬架構設計',
        '客製化功能開發',
        '企業系統整合',
        '專業顧問服務'
      ]
    },
    {
      emoji: '🏆',
      title: '專業支援',
      description: '全天候專業技術團隊，確保您的AI機器人穩定運行',
      highlights: [
        '24/7技術支援',
        '專屬客戶經理',
        '定期健檢服務',
        '培訓與諮詢'
      ]
    }
  ]);

  return (
    <SlideContainer>
      {/* Header Section */}
      <HeaderSection>
        <EmojiIcon>💼</EmojiIcon>
        <Headline>
          Enterprise Solutions<br />
          企業級解決方案
        </Headline>
        <Subline>專為企業打造的AI機器人解決方案，安全可靠，規模無限</Subline>
      </HeaderSection>

      {/* Enterprise Container */}
      <EnterpriseContainer>
        {/* Pricing Tiers */}
        <TierShowcase>
          {tiers.map((tier, index) => (
            <TierCard key={index} premium={tier.premium} index={index}>
              <TierIcon>{tier.icon}</TierIcon>
              <TierName premium={tier.premium}>{tier.name}</TierName>
              <TierPrice premium={tier.premium}>{tier.price}</TierPrice>
              <TierPeriod premium={tier.premium}>{tier.period}</TierPeriod>

              <FeatureList>
                {tier.features.map((feature, featureIndex) => (
                  <FeatureItem key={featureIndex} premium={tier.premium}>
                    <FeatureIcon premium={tier.premium}>✓</FeatureIcon>
                    {feature}
                  </FeatureItem>
                ))}
              </FeatureList>

              <TierButton href="#" premium={tier.premium}>
                {tier.buttonText}
              </TierButton>
            </TierCard>
          ))}
        </TierShowcase>

        {/* Enterprise Features */}
        <EnterpriseFeatures>
          {features.map((feature, index) => (
            <FeatureCategory key={index} index={index}>
              <FeatureHeader>
                <FeatureEmoji>{feature.emoji}</FeatureEmoji>
                <FeatureTitle>{feature.title}</FeatureTitle>
              </FeatureHeader>
              <FeatureDescription>{feature.description}</FeatureDescription>
              <FeatureHighlights>
                {feature.highlights.map((highlight, highlightIndex) => (
                  <FeatureHighlight key={highlightIndex}>
                    {highlight}
                  </FeatureHighlight>
                ))}
              </FeatureHighlights>
            </FeatureCategory>
          ))}
        </EnterpriseFeatures>

        {/* Security Banner */}
        <SecurityBanner>
          <SecurityContent>
            <SecurityTitle>
              🛡️ 企業級安全保障
            </SecurityTitle>
            <SecurityDescription>
              我們理解企業對於資料安全的重視，因此採用最高等級的安全措施，包括多層加密、身份驗證、存取控制等，確保您的商業資料絕對安全。
            </SecurityDescription>
          </SecurityContent>
        </SecurityBanner>
      </EnterpriseContainer>

      {/* CTA Section */}
      <CtaSection>
        <CtaButton href="#">
          預約企業諮詢
          <span>→</span>
        </CtaButton>
      </CtaSection>
    </SlideContainer>
  );
};

export default EClawSlide07;