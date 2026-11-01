import { useState } from 'react';
import CanvasList from './components/CanvasList';
import BrainMapCanvas from './components/BrainMapCanvas';

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

  return (
    <CanvasList
      onOpen={(id, name) => setView({ type: 'canvas', id, name })}
    />
  );
}
