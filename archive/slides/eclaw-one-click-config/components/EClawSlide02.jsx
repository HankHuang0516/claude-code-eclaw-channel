import React from 'react';
import styled, { keyframes, css } from 'styled-components';

// Animations
const fadeInUp = keyframes`
  from { opacity: 0; transform: translateY(30px); }
  to { opacity: 1; transform: translateY(0); }
`;

const pulse = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
`;

const coinBounce = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
`;

const arrowPulse = keyframes`
  0%, 100% { opacity: 0.8; }
  50% { opacity: 1; }
`;

const float = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-15px); }
`;

// Styled Components
const SlideContainer = styled.div`
  background: radial-gradient(800px circle at center, #FFFFFF 0%, #ECF0F1 100%);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow-x: hidden;
  position: relative;
`;

const ContentWrapper = styled.div`
  max-width: 1200px;
  width: 100%;
  padding: 64px;
  text-align: center;

  @media (max-width: 768px) {
    padding: 24px;
  }
`;

const FloatingCoins = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: -1;
`;

const FloatingCoin = styled.div`
  position: absolute;
  width: 24px;
  height: 24px;
  background: linear-gradient(145deg, #F39C12, #E67E22);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: white;
  font-weight: bold;
  animation: ${float} 3s infinite ease-in-out;

  &:nth-child(1) { top: 10%; left: 10%; animation-delay: 0s; }
  &:nth-child(2) { top: 20%; right: 15%; animation-delay: 0.5s; }
  &:nth-child(3) { top: 70%; left: 5%; animation-delay: 1s; }
  &:nth-child(4) { top: 80%; right: 10%; animation-delay: 1.5s; }
  &:nth-child(5) { top: 40%; left: 3%; animation-delay: 2s; }
  &:nth-child(6) { top: 60%; right: 8%; animation-delay: 2.5s; }

  @media (max-width: 768px) {
    display: none;
  }
`;

// Header Section
const HeaderSection = styled.div`
  margin-bottom: 60px;
  animation: ${fadeInUp} 0.8s ease-out;
`;

const EmojiIcon = styled.span`
  font-size: 56px;
  margin-bottom: 20px;
  display: block;
`;

const Headline = styled.h1`
  font-family: 'Noto Sans TC', sans-serif;
  font-size: 44px;
  font-weight: 700;
  color: #2C3E50;
  margin-bottom: 16px;
  line-height: 1.2;

  @media (max-width: 768px) {
    font-size: 32px;
  }
`;

const Subline = styled.p`
  font-size: 20px;
  color: #2E86C1;
  font-weight: 400;
  margin-bottom: 40px;

  @media (max-width: 768px) {
    font-size: 18px;
  }
`;

// Exchange Diagram
const ExchangeContainer = styled.div`
  margin-bottom: 80px;
  position: relative;
  height: 300px;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: ${fadeInUp} 0.8s ease-out 0.3s both;

  @media (max-width: 768px) {
    height: auto;
    flex-direction: column;
    gap: 40px;
    margin-bottom: 60px;
  }
`;

const BotAvatar = styled.div`
  width: 120px;
  height: 120px;
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  font-size: 24px;
  font-weight: 700;
  color: white;
  box-shadow: 0 8px 24px rgba(0,0,0,0.15);
`;

const SourceBot = styled(BotAvatar)`
  background: linear-gradient(145deg, #2E86C1, #1B4F72);
  margin-right: 200px;
  animation: ${pulse} 2s infinite ease-in-out;

  @media (max-width: 768px) {
    margin-right: 0;
  }
`;

const TargetBot = styled(BotAvatar)`
  background: linear-gradient(145deg, #27AE60, #1E8449);
  margin-left: 200px;
  animation: ${pulse} 2s infinite ease-in-out 0.5s;

  @media (max-width: 768px) {
    margin-left: 0;
  }
`;

const BotLabel = styled.div`
  font-size: 12px;
  margin-top: 8px;
  color: rgba(255,255,255,0.9);
`;

const CoinStack = styled.div`
  position: absolute;
  top: -15px;
  right: -15px;
  width: 30px;
  height: 30px;
  background: linear-gradient(145deg, #F39C12, #E67E22);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: white;
  font-weight: bold;
  animation: ${coinBounce} 1.5s infinite ease-in-out;
`;

const CapabilityBadge = styled.div`
  position: absolute;
  bottom: -15px;
  left: 50%;
  transform: translateX(-50%);
  background: #27AE60;
  color: white;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
`;

const ExchangeArrow = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;

  @media (max-width: 768px) {
    position: static;
    transform: none;
    order: 1;
  }
`;

const ArrowSVG = styled.svg`
  width: 160px;
  height: 60px;
  animation: ${arrowPulse} 2s infinite ease-in-out;

  @media (max-width: 768px) {
    width: 120px;
    height: 45px;
    transform: rotate(90deg);
  }
`;

const ArrowLabel = styled.div`
  font-size: 14px;
  color: #F39C12;
  font-weight: 600;
  margin-top: 8px;
  background: white;
  padding: 4px 8px;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
`;

// Feature Cards
const FeatureCards = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 32px;
  animation: ${fadeInUp} 0.8s ease-out 0.6s both;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
    gap: 24px;
  }
`;

const FeatureCard = styled.div`
  background: white;
  border: 2px solid #ECF0F1;
  border-radius: 12px;
  padding: 32px 24px;
  transition: all 0.3s ease;
  cursor: pointer;

  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 24px rgba(0,0,0,0.12);
    border-color: #2E86C1;
  }

  @media (max-width: 768px) {
    padding: 24px 20px;
  }
`;

const FeatureIcon = styled.span`
  font-size: 40px;
  margin-bottom: 16px;
  display: block;
`;

const FeatureTitle = styled.h3`
  font-size: 18px;
  font-weight: 600;
  color: #2C3E50;
  margin-bottom: 8px;
`;

const FeatureDescription = styled.p`
  font-size: 14px;
  color: #5D6D7E;
  line-height: 1.5;
`;

// Main Component
const EClawSlide02 = () => {
  const features = [
    {
      icon: "💰",
      title: "無需額外付費",
      description: "用賺取的 e-coin 直接租用，不需要額外的現金支出"
    },
    {
      icon: "🔄",
      title: "靈活選擇AI助手",
      description: "根據任務需求，隨時切換不同能力等級的AI助手"
    },
    {
      icon: "🌱",
      title: "真正的循環經濟",
      description: "賺取→租用→更高效→賺更多，形成正向循環"
    }
  ];

  return (
    <SlideContainer>
      {/* Floating Background Coins */}
      <FloatingCoins>
        <FloatingCoin>E</FloatingCoin>
        <FloatingCoin>E</FloatingCoin>
        <FloatingCoin>E</FloatingCoin>
        <FloatingCoin>E</FloatingCoin>
        <FloatingCoin>E</FloatingCoin>
        <FloatingCoin>E</FloatingCoin>
      </FloatingCoins>

      <ContentWrapper>
        {/* Header Section */}
        <HeaderSection>
          <EmojiIcon>⚡</EmojiIcon>
          <Headline>智能代幣經濟</Headline>
          <Subline>用賺到的 e-coin 租用更強大的AI</Subline>
        </HeaderSection>

        {/* Exchange Diagram */}
        <ExchangeContainer>
          <SourceBot>
            <div>🤖</div>
            <BotLabel>基礎AI</BotLabel>
            <CoinStack>5</CoinStack>
          </SourceBot>

          <ExchangeArrow>
            <ArrowSVG viewBox="0 0 160 60" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M20 20 C60 10, 100 10, 140 20"
                stroke="#F39C12"
                strokeWidth="3"
                fill="none"
                markerEnd="url(#arrowhead1)"
              />
              <path
                d="M140 40 C100 50, 60 50, 20 40"
                stroke="#F39C12"
                strokeWidth="3"
                fill="none"
                markerEnd="url(#arrowhead2)"
              />
              <defs>
                <marker
                  id="arrowhead1"
                  markerWidth="10"
                  markerHeight="7"
                  refX="10"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon points="0 0, 10 3.5, 0 7" fill="#F39C12"/>
                </marker>
                <marker
                  id="arrowhead2"
                  markerWidth="10"
                  markerHeight="7"
                  refX="0"
                  refY="3.5"
                  orient="auto"
                >
                  <polygon points="10 0, 0 3.5, 10 7" fill="#F39C12"/>
                </marker>
              </defs>
            </ArrowSVG>
            <ArrowLabel>e-coin 交換</ArrowLabel>
          </ExchangeArrow>

          <TargetBot>
            <div>🧠</div>
            <BotLabel>進階AI</BotLabel>
            <CapabilityBadge>GPT-4級別</CapabilityBadge>
          </TargetBot>
        </ExchangeContainer>

        {/* Feature Cards */}
        <FeatureCards>
          {features.map((feature, index) => (
            <FeatureCard key={index}>
              <FeatureIcon>{feature.icon}</FeatureIcon>
              <FeatureTitle>{feature.title}</FeatureTitle>
              <FeatureDescription>{feature.description}</FeatureDescription>
            </FeatureCard>
          ))}
        </FeatureCards>
      </ContentWrapper>
    </SlideContainer>
  );
};

export default EClawSlide02;