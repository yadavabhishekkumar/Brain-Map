import { useState } from 'react';
import CanvasList from './components/CanvasList';
import BrainMapCanvas from './components/BrainMapCanvas';
import Epaper from './components/Epaper';

export default function App() {
  const [view, setView] = useState({ type: 'list' });

  if (view.type === 'canvas') {
    return (
      <BrainMapCanvas
        canvasId={view.id}
        canvasName={view.name}
        onBack={() => setView({ type: 'list' })}
        onOpenCanvas={(id, name) => setView({ type: 'canvas', id, name })}
      />
    );
  }

  if (view.type === 'epaper') {
    return <Epaper onBack={() => setView({ type: 'list' })} />;
  }

  return (
    <CanvasList
      onOpen={(id, name) => setView({ type: 'canvas', id, name })}
      onOpenEpaper={() => setView({ type: 'epaper' })}
    />
  );
}
