import { Badge } from "platform-badge";
import { Text, View } from "react-native";
import { Banner } from "./banner";
import { Fade } from "./fade";

declare const __DEV__: boolean;

export const App = () => (
  <View>
    <Banner />
    <Badge />
    {__DEV__ ? <b /> : <i />}
    {process.env.EXPO_OS === "web" ? <Text>web</Text> : <q />}
    <Fade />
  </View>
);
