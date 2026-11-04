import { MotionConfig } from 'framer-motion';
import { SanctuaryProvider } from './context/SanctuaryContext';
import Sanctuary from './components/Sanctuary';

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <SanctuaryProvider>
        <Sanctuary />
      </SanctuaryProvider>
    </MotionConfig>
  );
}
