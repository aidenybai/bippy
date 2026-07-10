declare module "react-native/Libraries/Utilities/HMRClient" {
  interface HMRClientNativeInterface {
    enable: () => void;
    disable: () => void;
  }
  const HMRClient: HMRClientNativeInterface;
  export default HMRClient;
}
