import React from 'react';
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

const glow = keyframes`
  from {
    box-shadow:
      0 0 30px rgba(243, 156, 18, 0.4),
      inset 0 0 20px rgba(0, 0, 0, 0.1);
  }
  to {
    box-shadow:
      0 0 50px rgba(243, 156, 18, 0.6),
      inset 0 0 30px rgba(0, 0, 0, 0.05);
  }
`;

const float = keyframes`
  0%, 100% {
    transform: translateY(0px);
  }
  50% {
    transform: translateY(-10px);
  }
`;

const coinFloat = keyframes`
  0%, 100% {
    transform: translateY(0px) rotate(0deg);
  }
  33% {
    transform: translateY(-15px) rotate(120deg);
  }
  66% {
    transform: translateY(-5px) rotate(240deg);
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
  background: linear-gradient(135deg, #F39C12 15%, #FFFFFF 85%);

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-image:
      radial-gradient(circle at 25% 25%, rgba(243, 156, 18, 0.03) 0%, transparent 50%),
      radial-gradient(circle at 75% 75%, rgba(46, 134, 193, 0.03) 0%, transparent 50%);
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
  color: #2E86C1;
  margin-bottom: 40px;

  @media (max-width: 768px) {
    font-size: 16px;
  }
`;

const CentralIllustration = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: 60px;
  animation: ${slideInUp} 1s ease-out 0.3s both;
`;

const TimeBankFusion = styled.div`
  position: relative;
  width: 400px;
  height: 400px;
  display: flex;
  justify-content: center;
  align-items: center;

  @media (max-width: 768px) {
    width: 300px;
    height: 300px;
  }

  @media (max-width: 375px) {
    width: 250px;
    height: 250px;
  }
`;

const ClockCoinHybrid = styled.div`
  width: 300px;
  height: 300px;
  border-radius: 50%;
  background:
    linear-gradient(45deg, #F39C12 0%, #E67E22 50%, #F39C12 100%),
    conic-gradient(from 0deg, #F39C12 0deg, #E67E22 90deg, #D68910 180deg, #F39C12 270deg, #F39C12 360deg);
  border: 8px solid #FFFFFF;
  box-shadow:
    0 0 30px rgba(243, 156, 18, 0.4),
    inset 0 0 20px rgba(0, 0, 0, 0.1);
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  animation: ${glow} 3s ease-in-out infinite alternate;

  @media (max-width: 768px) {
    width: 240px;
    height: 240px;
  }

  @media (max-width: 375px) {
    width: 200px;
    height: 200px;
  }
`;

const ClockFace = styled.div`
  width: 260px;
  height: 260px;
  background: #FFFFFF;
  border-radius: 50%;
  position: relative;
  box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.1);

  @media (max-width: 768px) {
    width: 200px;
    height: 200px;
  }

  @media (max-width: 375px) {
    width: 160px;
    height: 160px;
  }
`;

const ClockNumber = styled.div`
  position: absolute;
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  font-size: 18px;
  color: #2C3E50;
  transform: translate(-50%, -50%);
`;

const CoinValue = styled.div`
  position: absolute;
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  font-size: 14px;
  color: #F39C12;
  background: rgba(255, 255, 255, 0.9);
  padding: 4px 8px;
  border-radius: 12px;
  transform: translate(-50%, -50%);
`;

const ClockHands = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
`;

const HourHand = styled.div`
  position: absolute;
  width: 4px;
  height: 60px;
  background: #2C3E50;
  border-radius: 2px;
  transform-origin: bottom center;
  top: -50px;
  left: -2px;
  transform: rotate(45deg);
`;

const MinuteHand = styled.div`
  position: absolute;
  width: 2px;
  height: 80px;
  background: #2C3E50;
  border-radius: 2px;
  transform-origin: bottom center;
  top: -50px;
  left: -1px;
  transform: rotate(135deg);
`;

const CenterDot = styled.div`
  width: 12px;
  height: 12px;
  background: #2C3E50;
  border-radius: 50%;
  position: absolute;
  top: -6px;
  left: -6px;
`;

const DigitalAssets = styled.div`
  position: absolute;
  width: 100%;
  height: 100%;
  pointer-events: none;
`;

const DataNode = styled.div`
  position: absolute;
  width: 12px;
  height: 12px;
  background: #2E86C1;
  border-radius: 50%;
  animation: ${float} 4s ease-in-out infinite;
  opacity: 0.7;

  ${props => props.delay && css`
    animation-delay: ${props.delay}s;
  `}
`;

const FloatingEcoin = styled.div`
  position: absolute;
  width: 24px;
  height: 24px;
  background: linear-gradient(45deg, #F39C12, #E67E22);
  border-radius: 50%;
  border: 2px solid #FFFFFF;
  box-shadow: 0 2px 8px rgba(243, 156, 18, 0.3);
  animation: ${coinFloat} 6s ease-in-out infinite;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: #FFFFFF;

  ${props => props.delay && css`
    animation-delay: ${props.delay}s;
  `}
`;

const PortfolioDashboard = styled.div`
  position: absolute;
  bottom: -20px;
  right: -30px;
  width: 180px;
  height: 120px;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  padding: 16px;
  animation: ${slideInRight} 1.2s ease-out 0.6s both;

  @media (max-width: 768px) {
    width: 140px;
    height: 100px;
    padding: 12px;
    bottom: -10px;
    right: -20px;
  }
`;

const DashboardHeader = styled.div`
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: 12px;
  color: #2C3E50;
  margin-bottom: 8px;
  text-align: center;
`;

const MiniChart = styled.div`
  width: 100%;
  height: 40px;
  background: linear-gradient(90deg, #27AE60 0%, #2ECC71 100%);
  border-radius: 4px;
  margin-bottom: 8px;
  position: relative;
  overflow: hidden;

  &::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: url("data:image/svg+xml,%3Csvg viewBox='0 0 100 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0,35 Q25,10 50,15 T100,5' stroke='white' stroke-width='2' fill='none' opacity='0.8'/%3E%3C/svg%3E");
    background-size: cover;
  }
`;

const ConversionDisplay = styled.div`
  font-family: 'Inter', sans-serif;
  font-size: 10px;
  color: #2E86C1;
  text-align: center;
  line-height: 1.2;
`;

const FeatureCards = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
  max-width: 900px;
  animation: ${slideInUp} 1s ease-out 0.6s both;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
    gap: 16px;
  }
`;

const FeatureCard = styled.div`
  background: #FFFFFF;
  border-radius: 16px;
  padding: 24px;
  border: 2px solid #ECF0F1;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  text-align: center;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 4px;
    background: linear-gradient(90deg, #F39C12, #E67E22);
    transform: scaleX(0);
    transition: transform 0.3s ease;
  }

  &:hover::before {
    transform: scaleX(1);
  }

  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 24px rgba(243, 156, 18, 0.15);
  }

  @media (max-width: 768px) {
    padding: 20px;
  }
`;

const CardIcon = styled.span`
  font-size: 32px;
  margin-bottom: 16px;
  display: block;
`;

const CardTitle = styled.h3`
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 600;
  font-size: 18px;
  color: #2C3E50;
  margin-bottom: 12px;
`;

const CardDescription = styled.p`
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 400;
  font-size: 14px;
  color: #7F8C8D;
  line-height: 1.5;
`;

const CtaSection = styled.div`
  text-align: center;
  margin-top: 48px;
  animation: ${slideInUp} 1s ease-out 0.9s both;
`;

const CtaButton = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 16px 32px;
  background: linear-gradient(135deg, #F39C12 0%, #E67E22 100%);
  color: #FFFFFF;
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  font-size: 16px;
  text-decoration: none;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(243, 156, 18, 0.3);
  transition: all 0.3s ease;
  text-transform: none;
  letter-spacing: 0.5px;

  &:hover {
    transform: scale(1.02);
    box-shadow: 0 8px 24px rgba(243, 156, 18, 0.4);
  }

  @media (max-width: 768px) {
    padding: 14px 28px;
    font-size: 14px;
  }
`;

// Component
const EClawSlide03 = () => {
  return (
    <SlideContainer>
      {/* Header Section */}
      <HeaderSection>
        <EmojiIcon>🕐</EmojiIcon>
        <Headline>Time Bank - 將時間轉化為數位資產</Headline>
        <Subline>e-coin 代表儲存的時間價值，建立您的個人AI資產組合</Subline>
      </HeaderSection>

      {/* Central Illustration */}
      <CentralIllustration>
        <TimeBankFusion>
          {/* Hybrid Clock-Coin */}
          <ClockCoinHybrid>
            <ClockFace>
              {/* Clock Numbers */}
              <ClockNumber style={{ top: '15px', left: '50%', transform: 'translate(-50%, 0)' }}>
                12
              </ClockNumber>
              <ClockNumber style={{ top: '50%', right: '15px', transform: 'translate(50%, -50%)' }}>
                3
              </ClockNumber>
              <ClockNumber style={{ bottom: '15px', left: '50%', transform: 'translate(-50%, 0)' }}>
                6
              </ClockNumber>
              <ClockNumber style={{ top: '50%', left: '15px', transform: 'translate(-50%, -50%)' }}>
                9
              </ClockNumber>

              {/* Coin Values */}
              <CoinValue style={{ top: '30%', right: '30%' }}>100e</CoinValue>
              <CoinValue style={{ bottom: '30%', right: '30%' }}>50e</CoinValue>
              <CoinValue style={{ bottom: '30%', left: '30%' }}>75e</CoinValue>
              <CoinValue style={{ top: '30%', left: '30%' }}>25e</CoinValue>

              {/* Clock Hands */}
              <ClockHands>
                <HourHand />
                <MinuteHand />
                <CenterDot />
              </ClockHands>
            </ClockFace>
          </ClockCoinHybrid>

          {/* Digital Assets Stream */}
          <DigitalAssets>
            <DataNode style={{ top: '10%', left: '20%' }} delay={0} />
            <DataNode style={{ top: '20%', right: '15%' }} delay={1} />
            <DataNode style={{ bottom: '15%', right: '25%' }} delay={2} />
            <DataNode style={{ bottom: '20%', left: '15%' }} delay={3} />
            <DataNode style={{ top: '50%', left: '5%' }} delay={0.5} />
            <DataNode style={{ top: '50%', right: '5%' }} delay={1.5} />
          </DigitalAssets>

          {/* Floating E-coins */}
          <FloatingEcoin style={{ top: '5%', left: '80%' }} delay={0}>E</FloatingEcoin>
          <FloatingEcoin style={{ top: '75%', left: '5%' }} delay={2}>E</FloatingEcoin>
          <FloatingEcoin style={{ top: '85%', right: '10%' }} delay={4}>E</FloatingEcoin>

          {/* Portfolio Dashboard */}
          <PortfolioDashboard>
            <DashboardHeader>資產組合</DashboardHeader>
            <MiniChart />
            <ConversionDisplay>
              時間 → 價值<br />
              1hr = 10e-coin
            </ConversionDisplay>
          </PortfolioDashboard>
        </TimeBankFusion>
      </CentralIllustration>

      {/* Feature Cards */}
      <FeatureCards>
        <FeatureCard>
          <CardIcon>💰</CardIcon>
          <CardTitle>時間價值儲存</CardTitle>
          <CardDescription>e-coin 代表儲存的時間價值，可隨時兌換服務</CardDescription>
        </FeatureCard>
        <FeatureCard>
          <CardIcon>🌐</CardIcon>
          <CardTitle>跨平台通用</CardTitle>
          <CardDescription>打破傳統積分限制，真正的通用數位資產</CardDescription>
        </FeatureCard>
        <FeatureCard>
          <CardIcon>📈</CardIcon>
          <CardTitle>投資組合管理</CardTitle>
          <CardDescription>建立個人AI資產組合，實現時間投資回報</CardDescription>
        </FeatureCard>
      </FeatureCards>

      {/* CTA Section */}
      <CtaSection>
        <CtaButton href="#">
          了解時間銀行機制
          <span>→</span>
        </CtaButton>
      </CtaSection>
    </SlideContainer>
  );
};

export default EClawSlide03;