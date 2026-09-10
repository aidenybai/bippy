import { Text } from "react-native";
import { useAnimatedStyle, useSharedValue } from "react-native-reanimated";

export const Fade = () => {
  const opacity = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Text>
      {"captures "}
      {style.inputs.join(",")}
    </Text>
  );
};
