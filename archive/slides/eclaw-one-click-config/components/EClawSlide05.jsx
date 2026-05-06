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

const slideInRight = keyframes`
  from {
    opacity: 0;
    transform: translateX(30px);
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

const chartGrow = keyframes`
  from {
    transform: scaleY(0);
  }
  to {
    transform: scaleY(1);
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

const livePulse = keyframes`
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.6;
    transform: scale(1.2);
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
  background: linear-gradient(135deg, #2E86C1 15%, #FFFFFF 85%);

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-image:
      radial-gradient(circle at 25% 25%, rgba(46, 134, 193, 0.03) 0%, transparent 50%),
      radial-gradient(circle at 75% 75%, rgba(243, 156, 18, 0.03) 0%, transparent 50%);
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

const DashboardContainer = styled.div`
  width: 100%;
  max-width: 1000px;
  margin-bottom: 40px;
  animation: ${slideInUp} 1s ease-out 0.3s both;
`;

const MetricsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 24px;
  margin-bottom: 40px;

  @media (max-width: 768px) {
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
  }

  @media (max-width: 375px) {
    grid-template-columns: 1fr;
  }
`;

const MetricCard = styled.div`
  background: #FFFFFF;
  border-radius: 16px;
  padding: 24px 20px;
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
    background: ${props => {
      switch (props.index) {
        case 0: return 'linear-gradient(135deg, #27AE60 0%, #2ECC71 100%)';
        case 1: return 'linear-gradient(135deg, #2E86C1 0%, #3498DB 100%)';
        case 2: return 'linear-gradient(135deg, #F39C12 0%, #E67E22 100%)';
        case 3: return 'linear-gradient(135deg, #9B59B6 0%, #8E44AD 100%)';
        default: return 'linear-gradient(135deg, #2E86C1 0%, #3498DB 100%)';
      }
    }};
    transform: scaleX(0);
    transition: transform 0.4s ease;
  }

  &:hover::before {
    transform: scaleX(1);
  }

  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
    border-color: #2E86C1;
  }

  @media (max-width: 768px) {
    padding: 20px 16px;
  }
`;

const LiveIndicator = styled.div`
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: 11px;
  color: #27AE60;
  background: rgba(39, 174, 96, 0.1);
  padding: 4px 8px;
  border-radius: 20px;
`;

const LiveDot = styled.span`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #27AE60;
  animation: ${livePulse} 1.5s ease-in-out infinite;
`;

const MetricValue = styled.div`
  font-family: 'Inter', sans-serif;
  font-weight: 800;
  font-size: 32px;
  color: #2C3E50;
  margin-bottom: 8px;
  line-height: 1;
  animation: ${countUp} 1s ease-out ${props => 1 + props.index * 0.2}s both;

  @media (max-width: 768px) {
    font-size: 24px;
  }
`;

const MetricLabel = styled.div`
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 500;
  font-size: 14px;
  color: #7F8C8D;
  margin-bottom: 12px;
`;

const MetricTrend = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 20px;

  ${props => props.positive && css`
    background: rgba(39, 174, 96, 0.1);
    color: #27AE60;
  `}

  ${props => props.negative && css`
    background: rgba(231, 76, 60, 0.1);
    color: #E74C3C;
  `}
`;

const ChartSection = styled.div`
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 32px;
  margin-bottom: 40px;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
    gap: 24px;
  }
`;

const ChartContainer = styled.div`
  background: #FFFFFF;
  border-radius: 20px;
  padding: 32px 24px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  border: 2px solid #E5E7EB;

  @media (max-width: 768px) {
    padding: 20px 16px;
  }
`;

const ChartHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
`;

const ChartTitle = styled.h3`
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 600;
  font-size: 18px;
  color: #2C3E50;
`;

const ChartPeriod = styled.span`
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  font-size: 12px;
  color: #7F8C8D;
  background: #F8F9FA;
  padding: 6px 12px;
  border-radius: 20px;
`;

const ChartVisual = styled.div`
  width: 100%;
  height: 200px;
  background: linear-gradient(135deg, #F8F9FA 0%, #FFFFFF 100%);
  border-radius: 12px;
  position: relative;
  overflow: hidden;
`;

const ChartLine = styled.div`
  position: absolute;
  bottom: 20px;
  left: 20px;
  right: 20px;
  height: 2px;
  background: linear-gradient(135deg, #2E86C1 0%, #3498DB 100%);
  border-radius: 1px;

  &::before {
    content: '';
    position: absolute;
    top: -50px;
    left: 0;
    width: 100%;
    height: 100px;
    background: linear-gradient(to bottom, transparent 0%, rgba(46, 134, 193, 0.1) 100%);
    border-radius: 8px 8px 0 0;
    animation: ${chartGrow} 2s ease-out 1.5s both;
  }
`;

const ActivityFeed = styled.div`
  background: #FFFFFF;
  border-radius: 20px;
  padding: 24px 20px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  border: 2px solid #E5E7EB;

  @media (max-width: 768px) {
    padding: 20px 16px;
  }
`;

const ActivityHeader = styled.h3`
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 600;
  font-size: 16px;
  color: #2C3E50;
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid #E5E7EB;
`;

const ActivityItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(231, 234, 236, 0.5);
  animation: ${slideInRight} 0.6s ease-out ${props => 2 + props.index * 0.2}s both;

  &:last-child {
    border-bottom: none;
  }
`;

const ActivityDot = styled.div`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #27AE60;
  margin-top: 6px;
  flex-shrink: 0;
`;

const ActivityContent = styled.div`
  flex: 1;
`;

const ActivityText = styled.div`
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 400;
  font-size: 13px;
  color: #34495E;
  line-height: 1.4;
  margin-bottom: 2px;
`;

const ActivityTime = styled.div`
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  font-size: 11px;
  color: #7F8C8D;
`;

const AlertSection = styled.div`
  width: 100%;
  margin-bottom: 40px;
  animation: ${slideInUp} 1s ease-out 2.8s both;
`;

const AlertGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24px;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
`;

const AlertCard = styled.div`
  background: #FFFFFF;
  border-radius: 16px;
  padding: 24px 20px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  border-left: 4px solid ${props => props.type === 'success' ? '#27AE60' : '#F1C40F'};
  transition: all 0.4s ease;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  }
`;

const AlertHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
`;

const AlertIcon = styled.span`
  font-size: 20px;
`;

const AlertTitle = styled.h4`
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 600;
  font-size: 16px;
  color: #2C3E50;
`;

const AlertDescription = styled.p`
  font-family: 'Noto Sans TC', sans-serif;
  font-weight: 400;
  font-size: 14px;
  color: #7F8C8D;
  line-height: 1.5;
`;

const CtaSection = styled.div`
  text-align: center;
  animation: ${slideInUp} 1s ease-out 3.2s both;
`;

const CtaButton = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 16px 32px;
  background: linear-gradient(135deg, #2E86C1 0%, #3498DB 100%);
  color: #FFFFFF;
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  font-size: 16px;
  text-decoration: none;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(46, 134, 193, 0.3);
  transition: all 0.3s ease;
  text-transform: none;
  letter-spacing: 0.5px;

  &:hover {
    transform: scale(1.02);
    box-shadow: 0 8px 24px rgba(46, 134, 193, 0.4);
  }

  @media (max-width: 768px) {
    padding: 14px 28px;
    font-size: 14px;
  }
`;

// Component
const EClawSlide05 = () => {
  const [metrics, setMetrics] = useState([
    { value: '1,247', label: '今日任務完成', trend: '+15.3%', positive: true },
    { value: '98.7%', label: '系統可用率', trend: '+0.2%', positive: true },
    { value: '₩847K', label: '今日收益', trend: '+22.1%', positive: true },
    { value: '156ms', label: '平均回應時間', trend: '+12ms', positive: false }
  ]);

  const [activities] = useState([
    { text: '機器人 #AI-247 完成翻譯任務', time: '2分鐘前' },
    { text: '新訂單自動分派至最佳機器人', time: '5分鐘前' },
    { text: '系統效能優化完成', time: '12分鐘前' },
    { text: '收益達成今日目標', time: '15分鐘前' }
  ]);

  const [alerts] = useState([
    {
      type: 'success',
      icon: '✅',
      title: '系統運作正常',
      description: '所有機器人運作狀態良好，無異常警報'
    },
    {
      type: 'warning',
      icon: '⚠️',
      title: '建議優化',
      description: '檢測到回應時間略有增長，建議檢查伺服器負載'
    }
  ]);

  useEffect(() => {
    // Simulate real-time data updates
    const interval = setInterval(() => {
      setMetrics(prev => prev.map((metric, index) => {
        if (index === 0) {
          // Update task completion count
          const currentValue = parseInt(metric.value.replace(',', ''));
          const newValue = currentValue + Math.floor(Math.random() * 5) + 1;
          return {
            ...metric,
            value: newValue.toLocaleString()
          };
        }
        return metric;
      }));
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  return (
    <SlideContainer>
      {/* Header Section */}
      <HeaderSection>
        <EmojiIcon>📊</EmojiIcon>
        <Headline>
          Real-time Performance Tracking<br />
          即時效能追蹤儀表板
        </Headline>
        <Subline>全方位監控機器人表現，數據驅動優化決策</Subline>
      </HeaderSection>

      {/* Dashboard Container */}
      <DashboardContainer>
        {/* Key Metrics Grid */}
        <MetricsGrid>
          {metrics.map((metric, index) => (
            <MetricCard key={index} index={index}>
              <LiveIndicator>
                <LiveDot />
                LIVE
              </LiveIndicator>
              <MetricValue index={index}>{metric.value}</MetricValue>
              <MetricLabel>{metric.label}</MetricLabel>
              <MetricTrend positive={metric.positive} negative={!metric.positive}>
                {metric.positive ? '↗' : '↘'} {metric.trend}
              </MetricTrend>
            </MetricCard>
          ))}
        </MetricsGrid>

        {/* Charts Section */}
        <ChartSection>
          <ChartContainer>
            <ChartHeader>
              <ChartTitle>效能趨勢</ChartTitle>
              <ChartPeriod>過去24小時</ChartPeriod>
            </ChartHeader>
            <ChartVisual>
              <ChartLine />
            </ChartVisual>
          </ChartContainer>

          <ActivityFeed>
            <ActivityHeader>即時動態</ActivityHeader>
            {activities.map((activity, index) => (
              <ActivityItem key={index} index={index}>
                <ActivityDot />
                <ActivityContent>
                  <ActivityText>{activity.text}</ActivityText>
                  <ActivityTime>{activity.time}</ActivityTime>
                </ActivityContent>
              </ActivityItem>
            ))}
          </ActivityFeed>
        </ChartSection>

        {/* Alerts Section */}
        <AlertSection>
          <AlertGrid>
            {alerts.map((alert, index) => (
              <AlertCard key={index} type={alert.type}>
                <AlertHeader>
                  <AlertIcon>{alert.icon}</AlertIcon>
                  <AlertTitle>{alert.title}</AlertTitle>
                </AlertHeader>
                <AlertDescription>{alert.description}</AlertDescription>
              </AlertCard>
            ))}
          </AlertGrid>
        </AlertSection>
      </DashboardContainer>

      {/* CTA Section */}
      <CtaSection>
        <CtaButton href="#">
          查看完整儀表板
          <span>→</span>
        </CtaButton>
      </CtaSection>
    </SlideContainer>
  );
};

export default EClawSlide05;