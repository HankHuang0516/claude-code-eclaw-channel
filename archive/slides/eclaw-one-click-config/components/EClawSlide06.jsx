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

const coreGlow = keyframes`
  0%, 100% {
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  }
  50% {
    box-shadow: 0 8px 32px rgba(46, 134, 193, 0.3);
  }
`;

const nodeFloat = keyframes`
  0%, 100% {
    transform: translateY(0px);
  }
  50% {
    transform: translateY(-10px);
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
  background: linear-gradient(135deg, #3F51B5 15%, #FFFFFF 85%);

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-image:
      radial-gradient(circle at 25% 25%, rgba(63, 81, 181, 0.03) 0%, transparent 50%),
      radial-gradient(circle at 75% 75%, rgba(155, 89, 182, 0.03) 0%, transparent 50%);
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
  color: #2C3E50;
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
  color: #3F51B5;
  margin-bottom: 40px;

  @media (max-width: 768px) {
    font-size: 16px;
  }
`;

const EcosystemContainer = styled.div`
  width: 100%;
  max-width: 1000px;
  margin-bottom: 40px;
  animation: ${slideInUp} 1s ease-out 0.3s both;
`;

const CentralHub = styled.div`
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: 60px;
  height: 300px;

  @media (max-width: 768px) {
    height: 250px;
    margin-bottom: 40px;
  }

  @media (max-width: 375px) {
    height: 200px;
  }
`;

const HubCore = styled.div`
  width: 120px;
  height: 120px;
  background: linear-gradient(135deg, #2E86C1 0%, #3498DB 100%);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #FFFFFF;
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  font-size: 14px;
  text-align: center;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  position: relative;
  z-index: 10;
  animation: ${coreGlow} 3s ease-in-out infinite;

  &::after {
    content: '';
    position: absolute;
    width: 140px;
    height: 140px;
    border: 2px dashed #2E86C1;
    border-radius: 50%;
    animation: ${rotate} 20s linear infinite;
  }

  @media (max-width: 768px) {
    width: 100px;
    height: 100px;
    font-size: 12px;

    &::after {
      width: 120px;
      height: 120px;
    }
  }

  @media (max-width: 375px) {
    width: 80px;
    height: 80px;
    font-size: 11px;
  }
`;

const IntegrationNode = styled.div`
  position: absolute;
  width: 80px;
  height: 80px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #FFFFFF;
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: 11px;
  text-align: center;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  cursor: pointer;
  transition: all 0.4s ease;
  z-index: 5;

  &:hover {
    transform: scale(1.1);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  }

  &::before {
    content: '';
    position: absolute;
    width: 2px;
    height: 60px;
    background: linear-gradient(135deg, #E5E7EB 0%, transparent 100%);
    transform-origin: bottom;
  }

  ${props => props.position === 'top' && css`
    top: -40px;
    left: 50%;
    transform: translateX(-50%);
    background: linear-gradient(135deg, #27AE60 0%, #2ECC71 100%);
    animation: ${nodeFloat} 2s ease-in-out infinite 0.5s;

    &::before {
      transform: translateX(-50%) rotate(180deg);
      bottom: -60px;
    }
  `}

  ${props => props.position === 'right' && css`
    top: 30px;
    right: -60px;
    background: linear-gradient(135deg, #F39C12 0%, #E67E22 100%);
    animation: ${nodeFloat} 2s ease-in-out infinite 1s;

    &::before {
      transform: rotate(135deg);
      bottom: -30px;
      left: -30px;
    }
  `}

  ${props => props.position === 'bottom-right' && css`
    bottom: -40px;
    right: 20px;
    background: linear-gradient(135deg, #9B59B6 0%, #8E44AD 100%);
    animation: ${nodeFloat} 2s ease-in-out infinite 1.5s;

    &::before {
      transform: rotate(45deg);
      top: -30px;
      left: -30px;
    }
  `}

  ${props => props.position === 'bottom-left' && css`
    bottom: -40px;
    left: 20px;
    background: linear-gradient(135deg, #E91E63 0%, #C2185B 100%);
    animation: ${nodeFloat} 2s ease-in-out infinite 2s;

    &::before {
      transform: rotate(-45deg);
      top: -30px;
      right: -30px;
    }
  `}

  ${props => props.position === 'left' && css`
    top: 30px;
    left: -60px;
    background: linear-gradient(135deg, #3F51B5 0%, #303F9F 100%);
    animation: ${nodeFloat} 2s ease-in-out infinite 2.5s;

    &::before {
      transform: rotate(-135deg);
      bottom: -30px;
      right: -30px;
    }
  `}

  @media (max-width: 768px) {
    width: 60px;
    height: 60px;
    font-size: 10px;
  }

  @media (max-width: 375px) {
    width: 50px;
    height: 50px;
    font-size: 9px;
  }
`;

const IntegrationGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 32px;
  margin-bottom: 40px;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
    gap: 24px;
  }
`;

const IntegrationCategory = styled.div`
  background: #FFFFFF;
  border-radius: 20px;
  padding: 32px 24px;
  text-align: center;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  border: 2px solid #E5E7EB;
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
    background: linear-gradient(135deg, #27AE60 0%, #2ECC71 100%);
  }

  &:nth-child(2)::before {
    background: linear-gradient(135deg, #F39C12 0%, #E67E22 100%);
  }

  &:nth-child(3)::before {
    background: linear-gradient(135deg, #9B59B6 0%, #8E44AD 100%);
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

const CategoryIcon = styled.span`
  font-size: 48px;
  margin-bottom: 20px;
  display: block;

  @media (max-width: 768px) {
    font-size: 36px;
  }
`;

const CategoryTitle = styled.h3`
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 600;
  font-size: 20px;
  color: #2C3E50;
  margin-bottom: 16px;
`;

const CategoryDescription = styled.p`
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 400;
  font-size: 14px;
  color: #7F8C8D;
  line-height: 1.6;
  margin-bottom: 20px;
`;

const PlatformList = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
`;

const PlatformTag = styled.span`
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  font-size: 11px;
  background: #F8F9FA;
  color: #34495E;
  padding: 6px 12px;
  border-radius: 20px;
  border: 1px solid #E5E7EB;
  transition: all 0.3s ease;
  cursor: pointer;

  &:hover {
    background: #2E86C1;
    color: #FFFFFF;
    border-color: #2E86C1;
  }
`;

const StatsBanner = styled.div`
  background: linear-gradient(135deg, #3F51B5 0%, #303F9F 100%);
  color: #FFFFFF;
  padding: 24px 32px;
  border-radius: 16px;
  text-align: center;
  margin-bottom: 40px;
  animation: ${slideInUp} 1s ease-out 3s both;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
`;

const StatsContent = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 32px;
  align-items: center;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
    gap: 20px;
  }
`;

const StatItem = styled.div`
  text-align: center;
`;

const StatNumber = styled.div`
  font-family: 'Inter', sans-serif;
  font-weight: 800;
  font-size: 32px;
  margin-bottom: 8px;
  animation: ${countUp} 1s ease-out 3.5s both;

  @media (max-width: 768px) {
    font-size: 24px;
  }
`;

const StatLabel = styled.div`
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 500;
  font-size: 14px;
  opacity: 0.9;
`;

const CtaSection = styled.div`
  text-align: center;
  animation: ${slideInUp} 1s ease-out 4s both;
`;

const CtaButton = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 16px 32px;
  background: linear-gradient(135deg, #3F51B5 0%, #303F9F 100%);
  color: #FFFFFF;
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  font-size: 16px;
  text-decoration: none;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(63, 81, 181, 0.3);
  transition: all 0.3s ease;
  text-transform: none;
  letter-spacing: 0.5px;

  &:hover {
    transform: scale(1.02);
    box-shadow: 0 8px 24px rgba(63, 81, 181, 0.4);
  }

  @media (max-width: 768px) {
    padding: 14px 28px;
    font-size: 14px;
  }
`;

// Component
const EClawSlide06 = () => {
  const [integrationCategories] = useState([
    {
      icon: '💬',
      title: '通訊整合',
      description: '連接各大通訊平台，讓AI機器人在用戶常用的平台上提供服務',
      platforms: ['Discord', 'Telegram', 'Slack', 'Teams', 'LINE', 'WhatsApp']
    },
    {
      icon: '🚀',
      title: '開發生態',
      description: '與主流開發工具深度整合，提升開發者體驗和工作效率',
      platforms: ['GitHub', 'GitLab', 'VS Code', 'JetBrains', 'Docker', 'Kubernetes']
    },
    {
      icon: '☁️',
      title: '雲端基建',
      description: '支援各大雲端平台部署，確保高可用性和全球化服務',
      platforms: ['AWS', 'Azure', 'GCP', 'Railway', 'Vercel', 'DigitalOcean']
    }
  ]);

  const [stats] = useState([
    { number: '50+', label: '支援平台' },
    { number: '99.9%', label: '整合成功率' },
    { number: '24/7', label: '即時同步' }
  ]);

  const [integrationNodes] = useState([
    { position: 'top', label: '通訊\n平台' },
    { position: 'right', label: '社群\n媒體' },
    { position: 'bottom-right', label: '開發\n工具' },
    { position: 'bottom-left', label: '商務\n平台' },
    { position: 'left', label: '雲端\n服務' }
  ]);

  return (
    <SlideContainer>
      {/* Header Section */}
      <HeaderSection>
        <EmojiIcon>🔗</EmojiIcon>
        <Headline>
          Cross-platform Integration Ecosystem<br />
          跨平台整合生態系統
        </Headline>
        <Subline>無縫連接各大平台，打造全方位AI服務體驗</Subline>
      </HeaderSection>

      {/* Ecosystem Container */}
      <EcosystemContainer>
        {/* Central Hub Visualization */}
        <CentralHub>
          <HubCore>
            EClaw<br />Hub
          </HubCore>

          {integrationNodes.map((node, index) => (
            <IntegrationNode key={index} position={node.position}>
              {node.label}
            </IntegrationNode>
          ))}
        </CentralHub>

        {/* Integration Categories */}
        <IntegrationGrid>
          {integrationCategories.map((category, index) => (
            <IntegrationCategory key={index} index={index}>
              <CategoryIcon>{category.icon}</CategoryIcon>
              <CategoryTitle>{category.title}</CategoryTitle>
              <CategoryDescription>{category.description}</CategoryDescription>
              <PlatformList>
                {category.platforms.map((platform, platformIndex) => (
                  <PlatformTag key={platformIndex}>{platform}</PlatformTag>
                ))}
              </PlatformList>
            </IntegrationCategory>
          ))}
        </IntegrationGrid>

        {/* Integration Stats Banner */}
        <StatsBanner>
          <StatsContent>
            {stats.map((stat, index) => (
              <StatItem key={index}>
                <StatNumber>{stat.number}</StatNumber>
                <StatLabel>{stat.label}</StatLabel>
              </StatItem>
            ))}
          </StatsContent>
        </StatsBanner>
      </EcosystemContainer>

      {/* CTA Section */}
      <CtaSection>
        <CtaButton href="#">
          探索整合方案
          <span>→</span>
        </CtaButton>
      </CtaSection>
    </SlideContainer>
  );
};

export default EClawSlide06;