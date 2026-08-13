import { Canvas, Circle, Group, Rect } from "@shopify/react-native-skia";
import { createContext, memo, useContext, useState } from "react";
import { View } from "react-native";

const SkiaTestContext = createContext("skia-context-default");

interface SkiaMemoLeafProps {
  revision: number;
}

const SkiaMemoLeaf = memo(({ revision }: SkiaMemoLeafProps) => {
  const color = useContext(SkiaTestContext);
  const [radius] = useState(12);
  return <Circle color={color} cx={24 + revision} cy={24} r={radius} />;
});
SkiaMemoLeaf.displayName = "SkiaMemoLeaf";

interface SkiaCompoundTreeProps {
  revision: number;
}

const SkiaCompoundTree = ({ revision }: SkiaCompoundTreeProps) => (
  <SkiaTestContext.Provider value={`skia-context-${revision}`}>
    <Group opacity={0.9}>
      <SkiaMemoLeaf revision={revision} />
    </Group>
    <Rect color="purple" height={18} width={30 + revision} x={46} y={15} />
  </SkiaTestContext.Provider>
);

interface SkiaProbeProps {
  isTreeVisible: boolean;
  revision: number;
}

export const SkiaProbe = ({ isTreeVisible, revision }: SkiaProbeProps) => (
  <View testID="skia-probe">
    <Canvas style={{ height: 64, width: 96 }} testID="skia-canvas">
      {isTreeVisible ? <SkiaCompoundTree revision={revision} /> : null}
    </Canvas>
  </View>
);
