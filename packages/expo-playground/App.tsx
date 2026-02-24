import { useEffect, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  type Fiber,
  type FiberRoot,
  getDisplayName,
  instrument,
  isCompositeFiber,
} from 'bippy';
import { getSource, normalizeFileName } from 'bippy/source';

interface RenderEvent {
  id: number;
  name: string;
  phase: string;
  source: string | null;
}

let eventIdCounter = 0;
let isProcessingStateUpdate = false;
const collectedEvents: RenderEvent[] = [];
let notifySubscriber: (() => void) | null = null;

const shortenPath = (filePath: string): string => {
  const nodeModulesIndex = filePath.lastIndexOf('node_modules/');
  if (nodeModulesIndex !== -1) {
    return filePath.slice(nodeModulesIndex + 'node_modules/'.length);
  }
  const packagesIndex = filePath.indexOf('packages/');
  if (packagesIndex !== -1) {
    return filePath.slice(packagesIndex);
  }
  const segments = filePath.split('/').filter(Boolean);
  if (segments.length > 3) {
    return segments.slice(-3).join('/');
  }
  return filePath;
};

const resolveSourceForFiber = async (fiber: Fiber): Promise<string | null> => {
  try {
    const fiberSource = await getSource(fiber);
    if (!fiberSource?.fileName) return null;
    const fileName = normalizeFileName(fiberSource.fileName);
    if (!fileName) return null;
    const shortName = shortenPath(fileName);
    const lineNumber = fiberSource.lineNumber ? `:${fiberSource.lineNumber}` : '';
    return `${shortName}${lineNumber}`;
  } catch {
    return null;
  }
};

instrument({
  onCommitFiberRoot(_rendererID: number, root: FiberRoot) {
    if (isProcessingStateUpdate) return;

    const fiber = root.current;
    if (!fiber) return;

    const compositeFibers: Array<{ fiber: Fiber; displayName: string; phase: string }> = [];
    const traversalStack: Fiber[] = [fiber];
    while (traversalStack.length > 0) {
      const currentFiber = traversalStack.pop()!;
      if (isCompositeFiber(currentFiber)) {
        const displayName = getDisplayName(currentFiber.type);
        if (displayName) {
          const phase = currentFiber.alternate ? 'update' : 'mount';
          compositeFibers.push({ fiber: currentFiber, displayName, phase });
        }
      }
      if (currentFiber.sibling) traversalStack.push(currentFiber.sibling);
      if (currentFiber.child) traversalStack.push(currentFiber.child);
    }

    Promise.all(
      compositeFibers.map(async ({ fiber: compositeFiber, displayName, phase }) => {
        const source = await resolveSourceForFiber(compositeFiber);
        return { id: eventIdCounter++, name: displayName, phase, source };
      }),
    ).then((resolvedEvents) => {
      collectedEvents.unshift(...resolvedEvents);
      if (collectedEvents.length > 50) {
        collectedEvents.length = 50;
      }
      notifySubscriber?.();
    });
  },
});

const App = () => {
  const [renderEvents, setRenderEvents] = useState<RenderEvent[]>([]);

  useEffect(() => {
    notifySubscriber = () => {
      // HACK: defer state update to next frame to avoid re-entrant commits
      requestAnimationFrame(() => {
        isProcessingStateUpdate = true;
        setRenderEvents([...collectedEvents]);
        requestAnimationFrame(() => {
          isProcessingStateUpdate = false;
        });
      });
    };
    return () => {
      notifySubscriber = null;
    };
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        <StatusBar style="light" />
        <Text style={styles.title}>bippy + Expo</Text>
        <Text style={styles.statusText}>
          {renderEvents.length > 0
            ? `Instrumentation active (${renderEvents.length} events)`
            : 'Waiting for events…'}
        </Text>

        <Counter />

        <Text style={styles.sectionTitle}>Render events</Text>
        {renderEvents.map((item) => (
          <View key={item.id} style={styles.eventRow}>
            <Text style={styles.eventPhase}>{item.phase}</Text>
            <View style={styles.eventDetails}>
              <Text style={styles.eventName}>{item.name}</Text>
              {item.source && (
                <Text style={styles.eventSource} numberOfLines={1}>
                  {item.source}
                </Text>
              )}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
};

const Counter = () => {
  const [count, setCount] = useState(0);

  return (
    <View style={styles.counterContainer}>
      <Text style={styles.counterLabel}>Counter: {count}</Text>
      <View style={styles.buttonRow}>
        <Pressable
          style={styles.button}
          onPress={() => setCount((previous) => previous - 1)}
        >
          <Text style={styles.buttonText}>−</Text>
        </Pressable>
        <Pressable
          style={styles.button}
          onPress={() => setCount((previous) => previous + 1)}
        >
          <Text style={styles.buttonText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 12,
  },
  statusText: {
    color: '#a1a1aa',
    fontSize: 14,
    marginBottom: 24,
  },
  counterContainer: {
    backgroundColor: '#18181b',
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
  },
  counterLabel: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  button: {
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 28,
  },
  buttonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
  },
  sectionTitle: {
    color: '#a1a1aa',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#27272a',
  },
  eventPhase: {
    color: '#a78bfa',
    fontSize: 12,
    fontWeight: '600',
    width: 70,
    textTransform: 'uppercase',
    paddingTop: 2,
  },
  eventDetails: {
    flex: 1,
  },
  eventName: {
    color: '#e4e4e7',
    fontSize: 14,
  },
  eventSource: {
    color: '#52525b',
    fontSize: 11,
    marginTop: 1,
  },
});

export default App;
