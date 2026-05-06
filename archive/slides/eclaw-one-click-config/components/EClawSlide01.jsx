import React from 'react';
import styled, { keyframes, css } from 'styled-components';

// Animations
const slideInLeft = keyframes`
  from { opacity: 0; transform: translateX(-100px); }
  to { opacity: 1; transform: translateX(0); }
`;

const slideInRight = keyframes`
  from { opacity: 0; transform: translateX(100px); }
  to { opacity: 1; transform: translateX(0); }
`;

const coinFloat = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-15px); }
`;

const zzz = keyframes`
  0%, 100% { opacity: 0.3; transform: translateY(0); }
  50% { opacity: 1; transform: translateY(-10px); }
`;

const blink = keyframes`
  0%, 95% { transform: scaleY(1); }
  97.5% { transform: scaleY(0.1); }
`;

// Styled Components
const SlideContainer = styled.div`
  background: linear-gradient(135deg, #2E86C1 15%, #FFFFFF 85%);
  min-height: 100vh;
  position: relative;
  overflow-x: hidden;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-image:
      radial-gradient(circle at 20% 20%, rgba(46, 134, 193, 0.03) 1px, transparent 1px),
      radial-gradient(circle at 80% 20%, rgba(46, 134, 193, 0.03) 1px, transparent 1px),
      radial-gradient(circle at 20% 80%, rgba(46, 134, 193, 0.03) 1px, transparent 1px),
      radial-gradient(circle at 80% 80%, rgba(46, 134, 193, 0.03) 1px, transparent 1px);
    background-size: 50px 50px;
    pointer-events: none;
  }
`;

const ContentWrapper = styled.div`
  max-width: 1200px;
  margin: 0 auto;
  min-height: 100vh;
  display: flex;
  align-items: center;
  padding: 64px;

  @media (max-width: 768px) {
    padding: 24px;
  }
`;

const ContentLayout = styled.div`
  display: grid;
  grid-template-columns: 60% 40%;
  gap: 64px;
  align-items: center;
  width: 100%;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
    gap: 32px;
  }
`;

const ContentArea = styled.div`
  position: relative;
  animation: ${slideInLeft} 0.8s ease-out;

  @media (max-width: 768px) {
    order: 1;
  }
`;

const EmojiIcon = styled.div`
  font-size: 64px;
  position: absolute;
  top: -32px;
  left: 0;
  z-index: 10;

  @media (max-width: 768px) {
    font-size: 48px;
    position: static;
    margin-bottom: 16px;
  }
`;

const Headline = styled.h1`
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 700;
  font-size: 48px;
  color: #2C3E50;
  line-height: 1.2;
  margin-bottom: 16px;
  margin-top: 32px;

  @media (max-width: 768px) {
    font-size: 32px;
    margin-top: 16px;
  }
`;

const Subline = styled.p`
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 500;
  font-size: 28px;
  color: #2E86C1;
  margin-bottom: 32px;

  @media (max-width: 768px) {
    font-size: 20px;
  }
`;

const KeyPointsList = styled.ul`
  list-style: none;
  margin-bottom: 40px;
  padding: 0;
`;

const KeyPoint = styled.li`
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 400;
  font-size: 18px;
  color: #2C3E50;
  line-height: 1.6;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 12px;

  &::before {
    content: '';
    width: 16px;
    height: 16px;
    background: radial-gradient(circle, #F39C12 40%, #E67E22 100%);
    border-radius: 50%;
    flex-shrink: 0;
  }

  @media (max-width: 768px) {
    font-size: 16px;
  }
`;

const CTAButton = styled.a`
  display: inline-block;
  background: #F39C12;
  color: white;
  text-decoration: none;
  padding: 18px 32px;
  border-radius: 8px;
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  font-size: 16px;
  width: 280px;
  text-align: center;
  transition: all 0.2s ease;
  box-shadow: 0 4px 12px rgba(243, 156, 18, 0.2);

  &:hover {
    transform: scale(1.02);
    box-shadow: 0 8px 20px rgba(243, 156, 18, 0.3);
    color: white;
  }

  @media (max-width: 768px) {
    font-size: 14px;
    width: 100%;
    max-width: 280px;
  }
`;

const VisualArea = styled.div`
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  animation: ${slideInRight} 0.8s ease-out;

  @media (max-width: 768px) {
    order: 0;
    height: 280px;
    margin-bottom: 32px;
  }
`;

const RobotContainer = styled.div`
  position: relative;
  width: 240px;
  height: 180px;
  margin-right: -80px;

  @media (max-width: 768px) {
    margin-right: 0;
    transform: scale(0.8);
  }
`;

const Robot = styled.div`
  width: 100%;
  height: 100%;
  background: linear-gradient(145deg, #3498DB, #2980B9);
  border-radius: 40px;
  position: relative;
  box-shadow: 0 20px 40px rgba(52, 152, 219, 0.3);
`;

const RobotHead = styled.div`
  width: 80px;
  height: 60px;
  background: linear-gradient(145deg, #5DADE2, #3498DB);
  border-radius: 30px;
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
`;

const RobotEyes = styled.div`
  display: flex;
  gap: 12px;
`;

const RobotEye = styled.div`
  width: 12px;
  height: 12px;
  background: #2C3E50;
  border-radius: 50%;
  animation: ${blink} 3s infinite;
`;

const RobotBody = styled.div`
  width: 120px;
  height: 80px;
  background: linear-gradient(145deg, #3498DB, #2980B9);
  border-radius: 20px;
  position: absolute;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
`;

const SleepIndicator = styled.div`
  position: absolute;
  top: -20px;
  right: -40px;
  font-size: 24px;
  color: #2C3E50;
  animation: ${zzz} 2s infinite;
`;

const DigitalClock = styled.div`
  position: absolute;
  top: -30px;
  right: -100px;
  background: #2C3E50;
  color: #27AE60;
  padding: 8px 12px;
  border-radius: 6px;
  font-family: 'Inter', monospace;
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 1px;
`;

const FloatingCoins = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
`;

const Coin = styled.div`
  position: absolute;
  width: 32px;
  height: 32px;
  background: linear-gradient(145deg, #F39C12, #E67E22);
  border-radius: 50%;
  box-shadow: 0 4px 8px rgba(243, 156, 18, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  color: white;
  font-size: 14px;

  ${props => props.small && css`
    width: 24px;
    height: 24px;
    font-size: 12px;
  `}

  ${props => props.tiny && css`
    width: 20px;
    height: 20px;
    font-size: 10px;
  `}

  &:nth-child(1) {
    top: 20%;
    left: 10%;
    animation: ${coinFloat} 2s infinite ease-in-out;
  }

  &:nth-child(2) {
    top: 40%;
    left: 20%;
    animation: ${coinFloat} 2.5s infinite ease-in-out 0.3s;
  }

  &:nth-child(3) {
    top: 60%;
    left: 5%;
    animation: ${coinFloat} 2.2s infinite ease-in-out 0.6s;
  }

  &:nth-child(4) {
    top: 30%;
    right: 10%;
    animation: ${coinFloat} 2.8s infinite ease-in-out 0.9s;
  }

  &:nth-child(5) {
    top: 70%;
    right: 20%;
    animation: ${coinFloat} 2.4s infinite ease-in-out 1.2s;
  }

  &:nth-child(6) {
    top: 50%;
    right: 5%;
    animation: ${coinFloat} 2.6s infinite ease-in-out 1.5s;
  }
`;

// Main Component
const EClawSlide01 = ({ onCTAClick = () => {} }) => {
  const keyPoints = [
    "將閒置的AI助手出租給需要的用戶",
    "24/7 自動運作，無需人工干預",
    "透過 e-coin 代幣系統獲得穩定收益",
    "完全被動收入，睡覺也在賺錢"
  ];

  return (
    <SlideContainer>
      <ContentWrapper>
        <ContentLayout>
          <ContentArea>
            <EmojiIcon>💤</EmojiIcon>
            <Headline>讓你的AI助手為你賺錢</Headline>
            <Subline>就算在睡覺時！</Subline>

            <KeyPointsList>
              {keyPoints.map((point, index) => (
                <KeyPoint key={index}>{point}</KeyPoint>
              ))}
            </KeyPointsList>

            <CTAButton href="#" onClick={onCTAClick}>
              立即註冊，開始賺取被動收入
            </CTAButton>
          </ContentArea>

          <VisualArea>
            <RobotContainer>
              <Robot>
                <RobotHead>
                  <RobotEyes>
                    <RobotEye />
                    <RobotEye />
                  </RobotEyes>
                </RobotHead>
                <RobotBody />
                <SleepIndicator>ZZZ</SleepIndicator>
                <DigitalClock>24/7 ACTIVE</DigitalClock>
              </Robot>
            </RobotContainer>

            <FloatingCoins>
              <Coin>E</Coin>
              <Coin small>E</Coin>
              <Coin tiny>E</Coin>
              <Coin>E</Coin>
              <Coin small>E</Coin>
              <Coin tiny>E</Coin>
            </FloatingCoins>
          </VisualArea>
        </ContentLayout>
      </ContentWrapper>
    </SlideContainer>
  );
};

export default EClawSlide01;