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

const shieldPulse = keyframes`
  0%, 100% {
    transform: scale(1);
  }
  33% {
    transform: scale(1.05);
  }
  66% {
    transform: scale(0.95);
  }
`;

const shieldGlow = keyframes`
  0%, 100% {
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
    filter: brightness(1);
  }
  50% {
    box-shadow: 0 8px 32px rgba(251, 192, 45, 0.3);
    filter: brightness(1.1);
  }
`;

const rotate = keyframes`
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
`;

const countUp = keyframes`
  from {
    transform: translateY(20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
`;

const securityPulse = keyframes`
  0%, 100% {
    transform: scale(1);
    opacity: 0.5;
  }
  50% {
    transform: scale(1.1);
    opacity: 0.8;
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
  background: linear-gradient(135deg, #1565C0 0%, #0D47A1 100%);

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-image:
      radial-gradient(circle at 20% 30%, rgba(251, 192, 45, 0.05) 0%, transparent 40%),
      radial-gradient(circle at 80% 70%, rgba(69, 39, 160, 0.05) 0%, transparent 40%),
      radial-gradient(circle at 50% 50%, rgba(46, 125, 50, 0.03) 0%, transparent 50%);
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
  animation: ${shieldPulse} 3s ease-in-out infinite;

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
  color: #FBC02D;
  margin-bottom: 40px;

  @media (max-width: 768px) {
    font-size: 16px;
  }
`;

const SecurityContainer = styled.div`
  width: 100%;
  max-width: 1000px;
  margin-bottom: 40px;
  animation: ${slideInUp} 1s ease-out 0.3s both;
`;

const SecurityShield = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: 60px;
  position: relative;
  height: 200px;

  @media (max-width: 768px) {
    height: 160px;
  }
`;

const SecurityIndicator = styled.div`
  position: absolute;
  width: 300px;
  height: 300px;
  border: 2px solid rgba(251, 192, 45, 0.2);
  border-radius: 50%;
  animation: ${securityPulse} 6s ease-in-out infinite;
`;

const ShieldCore = styled.div`
  width: 120px;
  height: 140px;
  background: linear-gradient(135deg, #FBC02D 0%, #F57F17 100%);
  clip-path: polygon(50% 0%, 0% 30%, 0% 80%, 50% 100%, 100% 80%, 100% 30%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #263238;
  font-family: 'Inter', sans-serif;
  font-weight: 800;
  font-size: 16px;
  text-align: center;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  position: relative;
  z-index: 10;
  animation: ${shieldGlow} 4s ease-in-out infinite;

  @media (max-width: 768px) {
    width: 100px;
    height: 120px;
    font-size: 14px;
  }

  @media (max-width: 375px) {
    width: 80px;
    height: 100px;
    font-size: 12px;
  }
`;

const ShieldRing = styled.div`
  position: absolute;
  border: 3px solid;
  border-radius: 50%;
  animation: ${rotate} 15s linear infinite;

  ${props => props.ring === 1 && css`
    width: 180px;
    height: 180px;
    border-color: rgba(251, 192, 45, 0.4);
    animation-delay: 0s;

    @media (max-width: 768px) {
      width: 150px;
      height: 150px;
    }
  `}

  ${props => props.ring === 2 && css`
    width: 220px;
    height: 220px;
    border-color: rgba(69, 39, 160, 0.3);
    animation-delay: -3s;
    animation-direction: reverse;

    @media (max-width: 768px) {
      width: 180px;
      height: 180px;
    }
  `}

  ${props => props.ring === 3 && css`
    width: 260px;
    height: 260px;
    border-color: rgba(46, 125, 50, 0.2);
    animation-delay: -6s;

    @media (max-width: 768px) {
      width: 210px;
      height: 210px;
    }
  `}
`;

const SecurityPillars = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 32px;
  margin-bottom: 40px;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
    gap: 24px;
  }
`;

const PillarCard = styled.div`
  background: #FFFFFF;
  border-radius: 20px;
  padding: 32px 24px;
  text-align: center;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  border: 2px solid #E0E0E0;
  transition: all 0.4s ease;
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 4px;
    transform: scaleX(0);
    transition: transform 0.4s ease;
  }

  &:nth-child(1)::before {
    background: linear-gradient(135deg, #1565C0 0%, #0D47A1 100%);
  }

  &:nth-child(2)::before {
    background: linear-gradient(135deg, #2E7D32 0%, #1B5E20 100%);
  }

  &:nth-child(3)::before {
    background: linear-gradient(135deg, #4527A0 0%, #311B92 100%);
  }

  &:hover::before {
    transform: scaleX(1);
  }

  &:hover {
    transform: translateY(-8px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  }

  ${props => props.index === 0 && css`
    animation: ${slideInLeft} 0.8s ease-out 1.5s both;
  `}

  ${props => props.index === 1 && css`
    animation: ${slideInUp} 0.8s ease-out 2s both;
  `}

  ${props => props.index === 2 && css`
    animation: ${slideInRight} 0.8s ease-out 2.5s both;
  `}

  @media (max-width: 768px) {
    padding: 24px 20px;
  }
`;

const PillarIcon = styled.div`
  width: 80px;
  height: 80px;
  margin: 0 auto 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  color: #FFFFFF;
  position: relative;

  ${props => props.index === 0 && css`
    background: linear-gradient(135deg, #1565C0 0%, #0D47A1 100%);
  `}

  ${props => props.index === 1 && css`
    background: linear-gradient(135deg, #2E7D32 0%, #1B5E20 100%);
  `}

  ${props => props.index === 2 && css`
    background: linear-gradient(135deg, #4527A0 0%, #311B92 100%);
  `}

  &::after {
    content: '';
    position: absolute;
    width: 100px;
    height: 100px;
    border-radius: 50%;
    border: 2px dashed;
    animation: ${rotate} 20s linear infinite reverse;

    ${props => props.index === 0 && css`
      border-color: rgba(21, 101, 192, 0.3);
    `}

    ${props => props.index === 1 && css`
      border-color: rgba(46, 125, 50, 0.3);
    `}

    ${props => props.index === 2 && css`
      border-color: rgba(69, 39, 160, 0.3);
    `}
  }

  @media (max-width: 375px) {
    width: 60px;
    height: 60px;
    font-size: 24px;

    &::after {
      width: 80px;
      height: 80px;
    }
  }
`;

const PillarTitle = styled.h3`
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 600;
  font-size: 20px;
  color: #263238;
  margin-bottom: 16px;
`;

const PillarDescription = styled.p`
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 400;
  font-size: 14px;
  color: #78909C;
  line-height: 1.6;
  margin-bottom: 20px;
`;

const SecurityFeatures = styled.ul`
  list-style: none;
  padding: 0;
  margin: 0;
  text-align: left;
`;

const SecurityFeature = styled.li`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 500;
  font-size: 13px;
  color: #37474F;
`;

const FeatureCheck = styled.span`
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #2E7D32;
  color: #FFFFFF;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  flex-shrink: 0;
`;

const ComplianceSection = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 24px;
  margin-bottom: 40px;

  @media (max-width: 768px) {
    grid-template-columns: repeat(2, 1fr);
    gap: 20px;
  }

  @media (max-width: 375px) {
    grid-template-columns: 1fr;
  }
`;

const ComplianceBadge = styled.div`
  background: #FFFFFF;
  border-radius: 16px;
  padding: 24px 20px;
  text-align: center;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  border: 2px solid #BBDEFB;
  transition: all 0.4s ease;

  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
    border-color: #1565C0;
  }

  ${props => props.index === 0 && css`
    animation: ${slideInLeft} 0.8s ease-out 3s both;
  `}

  ${props => props.index === 1 && css`
    animation: ${slideInUp} 0.8s ease-out 3.2s both;
  `}

  ${props => props.index === 2 && css`
    animation: ${slideInUp} 0.8s ease-out 3.4s both;
  `}

  ${props => props.index === 3 && css`
    animation: ${slideInRight} 0.8s ease-out 3.6s both;
  `}
`;

const BadgeIcon = styled.span`
  font-size: 24px;
  margin-bottom: 12px;
  display: block;
`;

const BadgeName = styled.h4`
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  font-size: 14px;
  color: #263238;
  margin-bottom: 8px;
`;

const BadgeDescription = styled.p`
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 400;
  font-size: 11px;
  color: #78909C;
  line-height: 1.4;
`;

const TrustBanner = styled.div`
  background: linear-gradient(135deg, #2E7D32 0%, #1B5E20 100%);
  color: #FFFFFF;
  padding: 32px 40px;
  border-radius: 20px;
  text-align: center;
  margin-bottom: 40px;
  animation: ${slideInUp} 1s ease-out 4s both;
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
    background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="lock" x="0" y="0" width="25" height="25" patternUnits="userSpaceOnUse"><text x="12.5" y="17" font-size="8" fill="rgba(255,255,255,0.1)" text-anchor="middle">🔒</text></pattern></defs><rect width="100" height="100" fill="url(%23lock)"/></svg>');
    pointer-events: none;
  }

  @media (max-width: 768px) {
    padding: 24px 20px;
  }
`;

const TrustContent = styled.div`
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 32px;
  align-items: center;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
    gap: 20px;
  }
`;

const TrustStat = styled.div`
  text-align: center;
`;

const TrustNumber = styled.div`
  font-family: 'Inter', sans-serif;
  font-weight: 800;
  font-size: 36px;
  margin-bottom: 8px;
  animation: ${countUp} 1s ease-out 4.5s both;

  @media (max-width: 768px) {
    font-size: 28px;
  }
`;

const TrustLabel = styled.div`
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 500;
  font-size: 14px;
  opacity: 0.9;
`;

const CtaSection = styled.div`
  text-align: center;
  animation: ${slideInUp} 1s ease-out 4.5s both;
`;

const CtaButton = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 18px 36px;
  background: linear-gradient(135deg, #FBC02D 0%, #F57F17 100%);
  color: #263238;
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  font-size: 16px;
  text-decoration: none;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(251, 192, 45, 0.15);
  transition: all 0.3s ease;
  text-transform: none;
  letter-spacing: 0.5px;

  &:hover {
    transform: scale(1.02);
    box-shadow: 0 8px 32px rgba(251, 192, 45, 0.25);
  }

  @media (max-width: 768px) {
    padding: 16px 32px;
    font-size: 14px;
  }
`;

// Component
const EClawSlide08 = () => {
  const [pillars] = useState([
    {
      icon: '🔒',
      title: '資料加密',
      description: '採用軍用級AES-256加密標準，確保資料在傳輸和存儲過程中的絕對安全',
      features: [
        '端到端加密傳輸',
        '資料庫加密存儲',
        '密鑰管理系統',
        '定期加密更新'
      ]
    },
    {
      icon: '👤',
      title: '身份驗證',
      description: '多因子身份驗證系統，確保只有授權人員能夠存取您的AI機器人和資料',
      features: [
        '多重身份驗證',
        '生物識別支援',
        '單點登錄(SSO)',
        '存取權限管控'
      ]
    },
    {
      icon: '🔍',
      title: '隱私保護',
      description: '嚴格遵循GDPR、CCPA等國際隱私法規，保障用戶個人資料隱私權',
      features: [
        '資料最小化原則',
        '同意機制管理',
        '資料可攜權',
        '被遺忘權'
      ]
    }
  ]);

  const [complianceBadges] = useState([
    {
      icon: '📋',
      name: 'ISO 27001',
      description: '國際資訊安全管理標準認證'
    },
    {
      icon: '🇪🇺',
      name: 'GDPR',
      description: '歐盟一般資料保護規範合規'
    },
    {
      icon: '🏛️',
      name: 'SOC 2',
      description: '服務組織控制報告認證'
    },
    {
      icon: '🏥',
      name: 'HIPAA',
      description: '健康保險隱私法案合規'
    }
  ]);

  const [trustStats] = useState([
    { number: '99.99%', label: '安全可用時間' },
    { number: '0', label: '資料外洩事件' },
    { number: '24/7', label: '安全監控' }
  ]);

  return (
    <SlideContainer>
      {/* Header Section */}
      <HeaderSection>
        <EmojiIcon>🛡️</EmojiIcon>
        <Headline>
          Security & Privacy Protection<br />
          安全與隱私保障
        </Headline>
        <Subline>多層次安全架構，守護您的數據與隱私</Subline>
      </HeaderSection>

      {/* Security Container */}
      <SecurityContainer>
        {/* Security Shield Visualization */}
        <SecurityShield>
          <SecurityIndicator />
          <ShieldRing ring={1} />
          <ShieldRing ring={2} />
          <ShieldRing ring={3} />
          <ShieldCore>
            🔐<br />EClaw<br />Shield
          </ShieldCore>
        </SecurityShield>

        {/* Security Pillars */}
        <SecurityPillars>
          {pillars.map((pillar, index) => (
            <PillarCard key={index} index={index}>
              <PillarIcon index={index}>{pillar.icon}</PillarIcon>
              <PillarTitle>{pillar.title}</PillarTitle>
              <PillarDescription>{pillar.description}</PillarDescription>
              <SecurityFeatures>
                {pillar.features.map((feature, featureIndex) => (
                  <SecurityFeature key={featureIndex}>
                    <FeatureCheck>✓</FeatureCheck>
                    {feature}
                  </SecurityFeature>
                ))}
              </SecurityFeatures>
            </PillarCard>
          ))}
        </SecurityPillars>

        {/* Compliance Badges */}
        <ComplianceSection>
          {complianceBadges.map((badge, index) => (
            <ComplianceBadge key={index} index={index}>
              <BadgeIcon>{badge.icon}</BadgeIcon>
              <BadgeName>{badge.name}</BadgeName>
              <BadgeDescription>{badge.description}</BadgeDescription>
            </ComplianceBadge>
          ))}
        </ComplianceSection>

        {/* Trust Statistics Banner */}
        <TrustBanner>
          <TrustContent>
            {trustStats.map((stat, index) => (
              <TrustStat key={index}>
                <TrustNumber>{stat.number}</TrustNumber>
                <TrustLabel>{stat.label}</TrustLabel>
              </TrustStat>
            ))}
          </TrustContent>
        </TrustBanner>
      </SecurityContainer>

      {/* CTA Section */}
      <CtaSection>
        <CtaButton href="#">
          了解安全架構
          <span>→</span>
        </CtaButton>
      </CtaSection>
    </SlideContainer>
  );
};

export default EClawSlide08;