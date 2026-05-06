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

const progressFill = keyframes`
  from {
    width: 0%;
  }
  to {
    width: 100%;
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
  background: linear-gradient(135deg, #27AE60 15%, #FFFFFF 85%);

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-image:
      radial-gradient(circle at 25% 25%, rgba(39, 174, 96, 0.03) 0%, transparent 50%),
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
  color: #27AE60;
  margin-bottom: 40px;

  @media (max-width: 768px) {
    font-size: 16px;
  }
`;

const StepFlowContainer = styled.div`
  width: 100%;
  max-width: 1000px;
  margin-bottom: 60px;
  animation: ${slideInUp} 1s ease-out 0.3s both;
`;

const ProgressBarContainer = styled.div`
  position: relative;
  margin-bottom: 60px;
`;

const ProgressBar = styled.div`
  width: 100%;
  height: 8px;
  background: #ECF0F1;
  border-radius: 4px;
  position: relative;
  overflow: hidden;
`;

const ProgressFill = styled.div`
  height: 100%;
  background: linear-gradient(90deg, #27AE60 0%, #2ECC71 100%);
  border-radius: 4px;
  width: 0%;
  animation: ${progressFill} 3s ease-in-out 1s forwards;
`;

const StepIndicators = styled.div`
  position: absolute;
  top: -20px;
  width: 100%;
  display: flex;
  justify-content: space-between;
`;

const StepIndicator = styled.div`
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #ECF0F1;
  border: 4px solid #FFFFFF;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  font-size: 16px;
  color: #7F8C8D;
  transition: all 0.6s ease;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);

  ${props => props.active && css`
    background: #27AE60;
    color: #FFFFFF;
    transform: scale(1.1);
  `}

  ${props => props.completed && css`
    background: #27AE60;
    color: #FFFFFF;
  `}
`;

const StepsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 40px;
  margin-top: 40px;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
    gap: 24px;
  }
`;

const StepCard = styled.div`
  background: #FFFFFF;
  border-radius: 20px;
  padding: 32px 24px;
  text-align: center;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
  border: 2px solid #ECF0F1;
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
    background: linear-gradient(90deg, #27AE60, #2ECC71);
    transform: scaleX(0);
    transition: transform 0.4s ease;
  }

  &:hover::before {
    transform: scaleX(1);
  }

  &:hover {
    transform: translateY(-8px);
    box-shadow: 0 16px 32px rgba(39, 174, 96, 0.15);
    border-color: #27AE60;
  }

  ${props => props.step === 1 && css`
    animation: ${slideInLeft} 0.8s ease-out 1.5s both;
  `}

  ${props => props.step === 2 && css`
    animation: ${slideInUp} 0.8s ease-out 2s both;
  `}

  ${props => props.step === 3 && css`
    animation: ${slideInRight} 0.8s ease-out 2.5s both;
  `}

  @media (max-width: 768px) {
    padding: 24px 20px;
  }
`;

const StepNumber = styled.div`
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: linear-gradient(135deg, #27AE60 0%, #2ECC71 100%);
  color: #FFFFFF;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  font-size: 24px;
  margin: 0 auto 20px;
  position: relative;

  &::after {
    content: '';
    position: absolute;
    width: 80px;
    height: 80px;
    border-radius: 50%;
    background: rgba(39, 174, 96, 0.2);
    animation: ${pulse} 2s ease-in-out infinite;
    z-index: -1;
  }

  @media (max-width: 375px) {
    width: 50px;
    height: 50px;
    font-size: 20px;
  }
`;

const StepIcon = styled.span`
  font-size: 32px;
  margin-bottom: 16px;
  display: block;
`;

const StepTitle = styled.h3`
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 600;
  font-size: 20px;
  color: #2C3E50;
  margin-bottom: 12px;
`;

const StepDescription = styled.p`
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 400;
  font-size: 14px;
  color: #7F8C8D;
  line-height: 1.6;
  margin-bottom: 16px;
`;

const VisualMockup = styled.div`
  width: 100%;
  height: 80px;
  margin: 16px 0;
  border-radius: 8px;
  position: relative;
  overflow: hidden;

  ${props => props.step === 1 && css`
    background: linear-gradient(135deg, #3498DB 0%, #2E86C1 100%);
  `}

  ${props => props.step === 2 && css`
    background: linear-gradient(135deg, #F39C12 0%, #E67E22 100%);
  `}

  ${props => props.step === 3 && css`
    background: linear-gradient(135deg, #27AE60 0%, #2ECC71 100%);
  `}
`;

const MockupContent = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #FFFFFF;
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: 12px;
  text-align: center;
`;

const StepTime = styled.span`
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  font-size: 12px;
  color: #27AE60;
  background: rgba(39, 174, 96, 0.1);
  padding: 6px 12px;
  border-radius: 20px;
  display: inline-block;
`;

const SuccessBanner = styled.div`
  background: linear-gradient(135deg, #27AE60 0%, #2ECC71 100%);
  color: #FFFFFF;
  padding: 20px 32px;
  border-radius: 16px;
  text-align: center;
  margin-bottom: 40px;
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 600;
  font-size: 18px;
  animation: ${slideInUp} 1s ease-out 3s both;
  box-shadow: 0 8px 24px rgba(39, 174, 96, 0.3);

  &::before {
    content: '🎉';
    margin-right: 12px;
  }
`;

const CtaSection = styled.div`
  text-align: center;
  animation: ${slideInUp} 1s ease-out 3.5s both;
`;

const CtaButton = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 16px 32px;
  background: linear-gradient(135deg, #27AE60 0%, #2ECC71 100%);
  color: #FFFFFF;
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  font-size: 16px;
  text-decoration: none;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(39, 174, 96, 0.3);
  transition: all 0.3s ease;
  text-transform: none;
  letter-spacing: 0.5px;

  &:hover {
    transform: scale(1.02);
    box-shadow: 0 8px 24px rgba(39, 174, 96, 0.4);
  }

  @media (max-width: 768px) {
    padding: 14px 28px;
    font-size: 14px;
  }
`;

// Component
const EClawSlide04 = () => {
  const [activeStep, setActiveStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState([]);

  useEffect(() => {
    // Animate progress indicators
    const timer1 = setTimeout(() => {
      setActiveStep(1);
    }, 1500);

    const timer2 = setTimeout(() => {
      setActiveStep(2);
      setCompletedSteps([1]);
    }, 2000);

    const timer3 = setTimeout(() => {
      setActiveStep(3);
      setCompletedSteps([1, 2]);
    }, 2500);

    const timer4 = setTimeout(() => {
      setActiveStep(0);
      setCompletedSteps([1, 2, 3]);
    }, 3000);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      clearTimeout(timer4);
    };
  }, []);

  return (
    <SlideContainer>
      {/* Header Section */}
      <HeaderSection>
        <EmojiIcon>🚀</EmojiIcon>
        <Headline>
          3 Steps to Success<br />
          從零到盈利只需要三步
        </Headline>
        <Subline>快速部署你的AI機器人，開始賺取被動收入</Subline>
      </HeaderSection>

      {/* Step Flow Container */}
      <StepFlowContainer>
        {/* Progress Bar */}
        <ProgressBarContainer>
          <ProgressBar>
            <ProgressFill />
          </ProgressBar>
          <StepIndicators>
            <StepIndicator
              active={activeStep === 1}
              completed={completedSteps.includes(1)}
            >
              1
            </StepIndicator>
            <StepIndicator
              active={activeStep === 2}
              completed={completedSteps.includes(2)}
            >
              2
            </StepIndicator>
            <StepIndicator
              active={activeStep === 3}
              completed={completedSteps.includes(3)}
            >
              3
            </StepIndicator>
          </StepIndicators>
        </ProgressBarContainer>

        {/* Steps Grid */}
        <StepsGrid>
          <StepCard step={1}>
            <StepNumber>1</StepNumber>
            <StepIcon>⚙️</StepIcon>
            <StepTitle>註冊設定</StepTitle>
            <StepDescription>
              快速註冊並設定你的AI機器人偏好，選擇專長領域和服務類型
            </StepDescription>
            <VisualMockup step={1}>
              <MockupContent>設定表單界面</MockupContent>
            </VisualMockup>
            <StepTime>⏱️ 5分鐘</StepTime>
          </StepCard>

          <StepCard step={2}>
            <StepNumber>2</StepNumber>
            <StepIcon>🚀</StepIcon>
            <StepTitle>一鍵部署</StepTitle>
            <StepDescription>
              一鍵部署到EClaw平台開始接單，自動匹配合適的任務
            </StepDescription>
            <VisualMockup step={2}>
              <MockupContent>部署按鈕界面</MockupContent>
            </VisualMockup>
            <StepTime>⏱️ 1分鐘</StepTime>
          </StepCard>

          <StepCard step={3}>
            <StepNumber>3</StepNumber>
            <StepIcon>📈</StepIcon>
            <StepTitle>監控優化</StepTitle>
            <StepDescription>
              監控收益並優化機器人效能，持續提升賺錢能力
            </StepDescription>
            <VisualMockup step={3}>
              <MockupContent>儀表板預覽</MockupContent>
            </VisualMockup>
            <StepTime>⏱️ 持續</StepTime>
          </StepCard>
        </StepsGrid>
      </StepFlowContainer>

      {/* Success Banner */}
      <SuccessBanner>
        恭喜！你的AI機器人已開始為你賺錢
      </SuccessBanner>

      {/* CTA Section */}
      <CtaSection>
        <CtaButton href="#">
          開始三步驟設置
          <span>→</span>
        </CtaButton>
      </CtaSection>
    </SlideContainer>
  );
};

export default EClawSlide04;