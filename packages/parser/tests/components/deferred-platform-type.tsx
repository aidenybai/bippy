import { useEffect, useState } from "react";

interface Settings {
  PLATFORM_TYPE?: string;
}

const loadSettings = (): Promise<Settings> =>
  new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ PLATFORM_TYPE: image.alt });
    image.src = "/settings.png";
  });

const Config = () => {
  const [isEnterprise, setEnterprise] = useState(false);
  const [isCloud, setCloud] = useState(false);
  const [isOpenSource, setOpenSource] = useState(false);
  useEffect(() => {
    Promise.all([loadSettings()]).then(([settings]) => {
      const finalData: Settings = { ...settings };
      if (finalData.PLATFORM_TYPE) {
        if (finalData.PLATFORM_TYPE === "enterprise") {
          setEnterprise(true);
          setCloud(false);
          setOpenSource(false);
        } else if (finalData.PLATFORM_TYPE === "cloud") {
          setCloud(true);
          setEnterprise(false);
          setOpenSource(false);
        } else {
          setOpenSource(true);
          setEnterprise(false);
          setCloud(false);
        }
      }
    });
  }, []);
  return (
    <div>
      {isCloud && <p>cloud</p>}
      {isEnterprise && <p>enterprise</p>}
      {isOpenSource && <p>open source</p>}
    </div>
  );
};

export const isPartial = true;
export default Config;
